import { promises as fs } from "node:fs";

const PROJECT_STATUS_FILE = new URL("../project_statuses.txt", import.meta.url);

const STATUS_NOISE_TOKENS = new Set([
  "estado",
  "estatus",
  "avance",
  "progreso",
  "seguimiento",
  "situacion",
  "actual",
  "actualmente",
  "proyecto",
  "proyectos",
  "servicio",
  "servicios",
  "tienda",
  "app",
  "aplicacion",
  "pagina",
  "web",
  "ecommerce",
  "de",
  "del",
  "la",
  "el",
  "los",
  "las",
  "mi",
  "su",
  "al",
  "a",
  "que",
  "como",
  "va",
  "sigue",
  "esta",
  "esta?",
  "en",
  "necesito",
  "quiero",
  "saber",
  "consultar",
  "ver",
  "revisar",
  "por",
  "favor"
]);

function normalize(value) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function compact(value, maxLength = 240) {
  const normalized = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!normalized) return null;
  return normalized.slice(0, maxLength);
}

function normalizeSearchText(value) {
  return normalize(value)
    .replace(/[^a-z0-9\s_-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function splitCsv(value) {
  return String(value ?? "")
    .split(",")
    .map((item) => compact(item, 120))
    .filter(Boolean);
}

function unique(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripStatusNoise(value) {
  const tokens = normalizeSearchText(value)
    .split(/\s+/)
    .filter(Boolean)
    .filter((token) => !STATUS_NOISE_TOKENS.has(token));

  if (!tokens.length) return null;
  return tokens.join(" ");
}

function parseProjectBlock(block) {
  const fields = {};
  let currentKey = null;

  for (const rawLine of String(block ?? "").split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (!trimmed) {
      currentKey = null;
      continue;
    }

    if (trimmed.startsWith("#")) continue;

    const fieldMatch = rawLine.match(/^\s*([a-z_]+)\s*:\s*(.*)$/i);
    if (fieldMatch) {
      currentKey = normalize(fieldMatch[1]);
      fields[currentKey] = compact(fieldMatch[2], 400) ?? "";
      continue;
    }

    if (currentKey && /^\s+/.test(rawLine)) {
      const continued = compact(rawLine, 300);
      if (continued) {
        fields[currentKey] = compact(`${fields[currentKey] ?? ""} ${continued}`, 400) ?? fields[currentKey];
      }
      continue;
    }

    currentKey = null;
  }

  const name = compact(fields.name, 120);
  if (!name) return null;

  const aliases = unique([name, ...splitCsv(fields.aliases)]).map((item) => String(item));
  return {
    name,
    aliases,
    status: compact(fields.status, 120),
    updated_at: compact(fields.updated_at, 40),
    owner: compact(fields.owner, 120),
    summary: compact(fields.summary, 320),
    next_step: compact(fields.next_step, 320),
    blockers: compact(fields.blockers, 320)
  };
}

export function parseProjectStatusesText(text) {
  const blocks = String(text ?? "")
    .split(/\[project\]/i)
    .slice(1);

  return blocks.map((block) => parseProjectBlock(block)).filter(Boolean);
}

function buildSearchTexts(input, context) {
  const directProjectName = compact(input?.project_name, 160);
  const directQuery = compact(input?.query, 240);
  const currentMessage = compact(context?.userMessage, 240);
  const history = Array.isArray(context?.history)
    ? context.history
        .filter((item) => item?.role === "user")
        .slice(-6)
        .map((item) => compact(item?.text, 240))
        .filter(Boolean)
    : [];

  const raw = unique([directProjectName, directQuery, currentMessage, ...history]);
  const cleaned = raw.map((item) => stripStatusNoise(item)).filter(Boolean);
  return unique([...raw, ...cleaned]).map((item) => normalizeSearchText(item)).filter(Boolean);
}

function scoreAliasAgainstText(alias, searchText) {
  const normalizedAlias = normalizeSearchText(alias);
  const normalizedText = normalizeSearchText(searchText);
  if (!normalizedAlias || !normalizedText) return 0;

  if (normalizedText === normalizedAlias) return 100;

  const aliasRegex = new RegExp(`(^|\\s)${escapeRegex(normalizedAlias)}($|\\s)`, "i");
  if (aliasRegex.test(normalizedText)) {
    return 95;
  }

  const aliasTokens = normalizedAlias.split(/\s+/).filter(Boolean);
  const textTokens = new Set(normalizedText.split(/\s+/).filter(Boolean));
  if (!aliasTokens.length || !textTokens.size) return 0;

  const overlap = aliasTokens.filter((token) => textTokens.has(token)).length;
  if (overlap === aliasTokens.length) {
    return 88;
  }

  const ratio = overlap / aliasTokens.length;
  if (ratio >= 0.7) {
    return 70 + Math.round(ratio * 10);
  }

  if (aliasTokens.length === 1 && normalizedText.includes(normalizedAlias)) {
    return 68;
  }

  return 0;
}

export function findProjectStatusMatches(projects, searchTexts) {
  const normalizedTexts = Array.isArray(searchTexts)
    ? searchTexts.map((item) => normalizeSearchText(item)).filter(Boolean)
    : [];

  const matches = [];
  for (const project of Array.isArray(projects) ? projects : []) {
    let bestScore = 0;
    let matchedBy = null;

    for (const alias of Array.isArray(project.aliases) ? project.aliases : []) {
      for (const searchText of normalizedTexts) {
        const score = scoreAliasAgainstText(alias, searchText);
        if (score > bestScore) {
          bestScore = score;
          matchedBy = alias;
        }
      }
    }

    if (bestScore > 0) {
      matches.push({
        project,
        score: bestScore,
        matched_by: matchedBy
      });
    }
  }

  matches.sort((a, b) => b.score - a.score || a.project.name.localeCompare(b.project.name));
  return matches;
}

function buildStatusReply(project) {
  const parts = [`Proyecto: ${project.name}`];
  if (project.status) parts.push(`Estado actual: ${project.status}`);
  if (project.summary) parts.push(`Resumen: ${project.summary}`);
  if (project.next_step) parts.push(`Siguiente paso: ${project.next_step}`);
  if (project.blockers) parts.push(`Pendientes o bloqueos: ${project.blockers}`);
  if (project.updated_at) parts.push(`Ultima actualizacion: ${project.updated_at}`);
  if (project.owner) parts.push(`Responsable: ${project.owner}`);
  return parts.join("\n");
}

export default {
  name: "lookup_project_status",
  description:
    "Consulta el estado actual de proyectos desde un archivo TXT editable para responder avances, progreso y situacion actual.",
  parameters: {
    type: "object",
    properties: {
      project_name: {
        type: "string",
        description: "Nombre o alias del proyecto a consultar."
      },
      query: {
        type: "string",
        description: "Pregunta o texto donde venga mencionado el proyecto."
      }
    },
    additionalProperties: false
  },
  async run(input, context) {
    const raw = await fs.readFile(PROJECT_STATUS_FILE, "utf8").catch(() => "");
    const projects = parseProjectStatusesText(raw);
    const availableProjects = projects.map((project) => project.name);
    const searchTexts = buildSearchTexts(input, context);
    const requestedProject =
      compact(input?.project_name, 160) ??
      compact(stripStatusNoise(input?.query), 160) ??
      compact(stripStatusNoise(context?.userMessage), 160);

    if (!projects.length) {
      return {
        ok: true,
        found: false,
        error: "no_projects_configured",
        requested_project: requestedProject ?? null,
        available_projects: [],
        response_hint:
          "No hay proyectos cargados en el archivo de estados. Actualiza agents/luxisoft/project_statuses.txt para responder esta consulta."
      };
    }

    let matches = findProjectStatusMatches(projects, searchTexts);
    if (!matches.length && projects.length === 1 && /(?:mi proyecto|el proyecto|la tienda|la web|la app)/i.test(context?.userMessage ?? "")) {
      matches = [{ project: projects[0], score: 60, matched_by: projects[0].name }];
    }

    if (!matches.length) {
      return {
        ok: true,
        found: false,
        error: "project_not_found",
        requested_project: requestedProject ?? null,
        available_projects: availableProjects,
        response_hint: availableProjects.length
          ? `No encontre ese proyecto en el archivo de estados. Los proyectos cargados son: ${availableProjects.join(", ")}.`
          : "No encontre proyectos cargados en el archivo de estados."
      };
    }

    const best = matches[0];
    return {
      ok: true,
      found: true,
      requested_project: requestedProject ?? null,
      matched_by: best.matched_by,
      project: {
        name: best.project.name,
        aliases: best.project.aliases,
        status: best.project.status,
        updated_at: best.project.updated_at,
        owner: best.project.owner,
        summary: best.project.summary,
        next_step: best.project.next_step,
        blockers: best.project.blockers
      },
      response_hint: buildStatusReply(best.project),
      available_projects: availableProjects
    };
  }
};
