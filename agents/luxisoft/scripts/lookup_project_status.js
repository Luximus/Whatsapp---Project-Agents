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
  "trabajo",
  "trabajos",
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

function parseProjectHeader(value) {
  const header = compact(value, 180);
  if (!header) return null;

  const aliasMatch = header.match(/^(.*?)\s*\((.*?)\)\s*$/);
  const name = compact(aliasMatch?.[1] ?? header, 120);
  if (!name) return null;

  const aliases = aliasMatch?.[2]
    ? aliasMatch[2]
        .split(",")
        .map((item) => compact(item, 120))
        .filter(Boolean)
    : [];

  return {
    name,
    aliases: unique([name, ...aliases]).map((item) => String(item))
  };
}

export function parseProjectStatusesText(text) {
  const paragraphs = String(text ?? "")
    .split(/\r?\n\s*\r?\n+/)
    .map((paragraph) =>
      paragraph
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith("#"))
        .join(" ")
    )
    .map((paragraph) => compact(paragraph, 900))
    .filter(Boolean);

  return paragraphs
    .map((paragraph) => {
      const match = String(paragraph).match(/^([^:]{2,180})\s*:\s*(.+)$/);
      if (!match?.[1] || !match?.[2]) return null;

      const header = parseProjectHeader(match[1]);
      const statusParagraph = compact(match[2], 700);
      if (!header || !statusParagraph) return null;

      return {
        name: header.name,
        aliases: header.aliases,
        status_paragraph: statusParagraph
      };
    })
    .filter(Boolean);
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
  return `Proyecto: ${project.name}\nEstado actual: ${project.status_paragraph}`;
}

export default {
  name: "lookup_project_status",
  description:
    "Consulta el estado actual de proyectos desde un archivo TXT plano editable, con un parrafo por proyecto.",
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
        status_paragraph: best.project.status_paragraph
      },
      response_hint: buildStatusReply(best.project),
      available_projects: availableProjects
    };
  }
};
