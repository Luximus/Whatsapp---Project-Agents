export type TurnCheck = {
  reply_contains?: string[];
  reply_not_contains?: string[];
  tools_called?: string[];
};

export type ConversationTurn = {
  user: string;
  check?: TurnCheck;
};

export type FinalAssertion = {
  id: string;
  description: string;
  check: (transcript: TurnRecord[], finalTurn: TurnRecord) => boolean;
};

export type TurnRecord = {
  index: number;
  user: string;
  reply: string;
  toolsUsed: string[];
  escalated: boolean;
  escalationSent: boolean;
};

export type TestCase = {
  id: string;
  name: string;
  description: string;
  case_type:
    | "cotizacion"
    | "soporte_ours"
    | "soporte_third_party"
    | "informacion"
    | "reunion_directa"
    | "seguimiento"
    | "general";
  phone: string;
  turns: ConversationTurn[];
  assertions: FinalAssertion[];
};

// ─── helpers ─────────────────────────────────────────────────────────────────

const replyContains = (turns: TurnRecord[], ...words: string[]) =>
  turns.some((t) => words.every((w) => t.reply.toLowerCase().includes(w.toLowerCase())));

const anyToolCalled = (turns: TurnRecord[], tool: string) =>
  turns.some((t) => t.toolsUsed.includes(tool));

const lastTool = (turn: TurnRecord, tool: string) => turn.toolsUsed.includes(tool);

const noRepeatedQuestions = (turns: TurnRecord[]) => {
  const questions = turns
    .map((t) => t.reply)
    .filter((r) => r.includes("?"))
    .map((r) => r.toLowerCase().trim());
  return new Set(questions).size === questions.length;
};

const reachedOutcome = (turns: TurnRecord[]) =>
  turns.some((t) => t.escalated || t.escalationSent);

const replyContainsAny = (turns: TurnRecord[], ...words: string[]) =>
  turns.some((t) => words.some((w) => t.reply.toLowerCase().includes(w.toLowerCase())));

// ─── test cases ──────────────────────────────────────────────────────────────

export const TEST_CASES: TestCase[] = [
  // ── 1. COTIZACION: pagina web completa ──────────────────────────────────
  {
    id: "cot_web_full",
    name: "Cotización página web - flujo completo",
    description:
      "Usuario solicita cotización de página web. El agente debe recopilar los 11 campos y agendar reunión.",
    case_type: "cotizacion",
    phone: "+573001000001",
    turns: [
      { user: "Hola, necesito cotizar una página web para mi empresa" },
      { user: "Carlos" },
      { user: "Rodriguez" },
      { user: "Acme Soluciones" },
      { user: "carlos@acmesoluciones.com" },
      { user: "Quiero mostrar mis servicios y captar clientes nuevos" },
      { user: "Tengo una página muy básica hecha en Wix" },
      { user: "Formulario de contacto, galería de servicios y blog" },
      { user: "Unos 3 millones de pesos colombianos" },
      { user: "2 meses" },
      { user: "Martes o miércoles en la tarde" }
    ],
    assertions: [
      {
        id: "tool_classify",
        description: "Debe usar classify_service_intent al inicio",
        check: (turns) => anyToolCalled(turns, "classify_service_intent")
      },
      {
        id: "tool_intake",
        description: "Debe usar next_intake_question durante la recopilación",
        check: (turns) => anyToolCalled(turns, "next_intake_question")
      },
      {
        id: "tool_meeting",
        description: "Debe llamar schedule_meeting_request al final",
        check: (turns) => anyToolCalled(turns, "schedule_meeting_request")
      },
      {
        id: "outcome_meeting",
        description: "Debe confirmar que la reunión fue agendada",
        check: (turns) => replyContainsAny(turns, "agende", "reunion agendada", "te contactar")
      },
      {
        id: "no_premature_done",
        description: "No debe decir 'ya tengo los datos principales' antes del turno 7",
        check: (turns) =>
          !turns
            .slice(0, 7)
            .some((t) => t.reply.toLowerCase().includes("ya tengo los datos principales"))
      },
      {
        id: "no_repeat_name",
        description: "No debe pedir el nombre más de una vez",
        check: (turns) => {
          const nameAsks = turns.filter(
            (t) =>
              t.reply.toLowerCase().includes("tu nombre") ||
              t.reply.toLowerCase().includes("tus nombres")
          );
          return nameAsks.length <= 1;
        }
      }
    ]
  },

  // ── 2. COTIZACION: app movil ─────────────────────────────────────────────
  {
    id: "cot_app_movil",
    name: "Cotización app móvil",
    description: "Usuario quiere una app para Android/iOS.",
    case_type: "cotizacion",
    phone: "+573001000002",
    turns: [
      { user: "Buenos días, me interesa desarrollar una app para mi negocio" },
      { user: "Ana Martínez" },
      { user: "FoodExpress" },
      { user: "ana@foodexpress.co" },
      { user: "Quiero que los clientes pidan comida a domicilio" },
      { user: "No tengo app todavía, solo un número de WhatsApp" },
      { user: "Menú, carrito de compras, seguimiento del pedido, pagos" },
      { user: "5 millones aproximadamente" },
      { user: "3 meses" },
      { user: "Lunes 10am" }
    ],
    assertions: [
      {
        id: "tool_classify",
        description: "Debe usar classify_service_intent",
        check: (turns) => anyToolCalled(turns, "classify_service_intent")
      },
      {
        id: "tool_meeting",
        description: "Debe llamar schedule_meeting_request",
        check: (turns) => anyToolCalled(turns, "schedule_meeting_request")
      },
      {
        id: "outcome_meeting",
        description: "Debe confirmar la reunión agendada",
        check: (turns) => replyContainsAny(turns, "agende", "reunion", "te contactar")
      }
    ]
  },

  // ── 3. COTIZACION: ecommerce ─────────────────────────────────────────────
  {
    id: "cot_ecommerce",
    name: "Cotización tienda ecommerce",
    description: "Usuario quiere una tienda virtual con pasarela de pago.",
    case_type: "cotizacion",
    phone: "+573001000003",
    turns: [
      { user: "Necesito crear una tienda virtual para vender ropa" },
      { user: "Pedro Gómez" },
      { user: "MarcaFashion" },
      { user: "pedro@marcafashion.com" },
      { user: "Vender online, manejar inventario y recibir pagos" },
      { user: "Tengo Instagram pero no tienda propia" },
      { user: "Catálogo, carrito, pagos PSE y tarjeta, gestión de pedidos" },
      { user: "4 millones" },
      { user: "6 semanas" },
      { user: "Jueves o viernes" }
    ],
    assertions: [
      {
        id: "tool_classify_ecommerce",
        description: "Debe clasificar como ecommerce",
        check: (turns) => anyToolCalled(turns, "classify_service_intent")
      },
      {
        id: "outcome_meeting",
        description: "Debe agendar reunión",
        check: (turns) => replyContainsAny(turns, "agende", "reunion", "te contactar")
      }
    ]
  },

  // ── 4. SOPORTE: servicio hecho por nosotros ──────────────────────────────
  {
    id: "sop_ours_full",
    name: "Soporte - servicio hecho por LUXISOFT",
    description: "Usuario reporta error en app hecha por nosotros. Debe registrar ticket.",
    case_type: "soporte_ours",
    phone: "+573001000004",
    turns: [
      { user: "Hola, tengo un problema con mi aplicación, no está funcionando" },
      {
        user: "Sí, fue con ustedes",
        check: {
          reply_not_contains: ["cotiz", "pagina web", "ecommerce"]
        }
      },
      { user: "Laura Pérez" },
      { user: "Distribuidora Sur" },
      { user: "laura@distribuidorasur.com" },
      {
        user: "La app se cae cada vez que intento ver el inventario, da error 500",
        check: {
          tools_called: ["register_support_ticket"]
        }
      }
    ],
    assertions: [
      {
        id: "ask_ownership",
        description: "Debe preguntar si fue con nosotros antes de recopilar datos",
        check: (turns) =>
          replyContainsAny(
            turns.slice(0, 2),
            "con nosotros",
            "nuestro equipo",
            "con otro proveedor",
            "terceros"
          )
      },
      {
        id: "tool_ticket",
        description: "Debe llamar register_support_ticket",
        check: (turns) => anyToolCalled(turns, "register_support_ticket")
      },
      {
        id: "outcome_ticket",
        description: "Debe confirmar que el ticket fue registrado",
        check: (turns) =>
          replyContainsAny(turns, "ticket", "registr", "equipo responder", "lo mas pronto")
      },
      {
        id: "no_cotizacion_tools",
        description: "No debe usar next_intake_question en soporte",
        check: (turns) => !anyToolCalled(turns, "next_intake_question")
      }
    ]
  },

  // ── 5. SOPORTE: servicio de terceros ─────────────────────────────────────
  {
    id: "sop_third_party",
    name: "Soporte - servicio de terceros",
    description: "Usuario tiene problema con app hecha por otra empresa. Debe agendar reunión de cotización.",
    case_type: "soporte_third_party",
    phone: "+573001000005",
    turns: [
      { user: "Necesito soporte, mi página web no carga" },
      {
        user: "No, fue con otra empresa",
        check: {
          reply_not_contains: ["ticket", "registr"]
        }
      },
      { user: "Marcos Silva" },
      { user: "marcos@techstore.com" },
      { user: "El sitio fue hecho por una agencia que ya cerró" },
      { user: "Lunes a las 2pm" }
    ],
    assertions: [
      {
        id: "no_ticket",
        description: "NO debe registrar ticket de soporte para terceros",
        check: (turns) => !anyToolCalled(turns, "register_support_ticket")
      },
      {
        id: "tool_meeting",
        description: "Debe agendar reunión para cotizar el soporte",
        check: (turns) => anyToolCalled(turns, "schedule_meeting_request")
      },
      {
        id: "outcome_meeting",
        description: "Debe confirmar reunión",
        check: (turns) => replyContainsAny(turns, "agende", "reunion", "cotizar")
      }
    ]
  },

  // ── 6. SOPORTE mal detectado: "ayuda" en contexto de cotización ──────────
  {
    id: "sop_false_positive",
    name: "No confundir soporte con cotización que menciona 'ayuda'",
    description: "Usuario dice 'necesito ayuda para crear una pagina web'. Esto es cotización, NO soporte.",
    case_type: "cotizacion",
    phone: "+573001000006",
    turns: [
      { user: "Hola, necesito ayuda para crear una página web para mi restaurante" },
      { user: "Sofía Torres" },
      { user: "Restaurante El Buen Sabor" },
      { user: "sofia@buensabor.com" }
    ],
    assertions: [
      {
        id: "no_ownership_question",
        description: "No debe preguntar si el servicio fue con nosotros en una cotización",
        check: (turns) =>
          !replyContainsAny(
            turns.slice(0, 2),
            "fue con nosotros",
            "fue con otro proveedor",
            "terceros"
          )
      },
      {
        id: "is_sales_flow",
        description: "Debe estar en flujo de ventas/cotización",
        check: (turns) => anyToolCalled(turns, "classify_service_intent")
      }
    ]
  },

  // ── 7. INFORMACION: estado de proyecto con nombre ─────────────────────────
  {
    id: "info_with_name",
    name: "Información - estado de proyecto conocido",
    description: "Usuario pregunta por el estado de un proyecto conocido en el sistema.",
    case_type: "informacion",
    phone: "+573001000007",
    turns: [
      { user: "Hola, cómo va el proyecto de Pandapan?" },
      {
        user: "Si, quiero saber el estado actual",
        check: {
          tools_called: ["lookup_project_status"]
        }
      }
    ],
    assertions: [
      {
        id: "tool_lookup",
        description: "Debe llamar lookup_project_status",
        check: (turns) => anyToolCalled(turns, "lookup_project_status")
      },
      {
        id: "no_cotizacion",
        description: "No debe iniciar un flujo de cotización",
        check: (turns) => !anyToolCalled(turns, "classify_service_intent")
      },
      {
        id: "no_ask_for_name",
        description: "No debe pedir nombre comercial cuando ya sabe el proyecto",
        check: (turns) =>
          !replyContainsAny(turns.slice(0, 1), "me compartes tu nombre", "indicame tus nombres")
      }
    ]
  },

  // ── 8. INFORMACION: estado sin nombre de proyecto ─────────────────────────
  {
    id: "info_no_name",
    name: "Información - estado de proyecto sin nombre",
    description: "Usuario pregunta por el estado de 'mi proyecto' sin decir el nombre.",
    case_type: "informacion",
    phone: "+573001000008",
    turns: [
      { user: "Cómo va mi proyecto?" },
      {
        user: "El de la tienda online",
        check: {
          tools_called: ["lookup_project_status"]
        }
      }
    ],
    assertions: [
      {
        id: "ask_project_name",
        description: "Debe pedir el nombre del proyecto cuando no se menciona",
        check: (turns) =>
          replyContainsAny(
            turns.slice(0, 1),
            "nombre del proyecto",
            "nombre de tu proyecto",
            "cual es el proyecto",
            "que proyecto"
          )
      },
      {
        id: "no_commercial_discovery",
        description: "No debe iniciar discovery comercial mientras pregunta por el proyecto",
        check: (turns) =>
          !replyContainsAny(
            turns.slice(0, 1),
            "cotizacion",
            "tipo de proyecto necesitas",
            "servicio digital"
          )
      }
    ]
  },

  // ── 9. REUNION: solicitud directa ─────────────────────────────────────────
  {
    id: "reunion_directa",
    name: "Solicitud de reunión directa",
    description: "Usuario quiere agendar una reunión directamente.",
    case_type: "reunion_directa",
    phone: "+573001000009",
    turns: [
      { user: "Hola, quisiera agendar una reunión con un especialista" },
      { user: "Javier Mora" },
      { user: "Mora Consulting" },
      { user: "javier@mora.com" },
      { user: "Discutir una posible automatización con IA para mi empresa" },
      { user: "Miércoles a las 10am" }
    ],
    assertions: [
      {
        id: "tool_meeting",
        description: "Debe llamar schedule_meeting_request",
        check: (turns) => anyToolCalled(turns, "schedule_meeting_request")
      },
      {
        id: "outcome_meeting",
        description: "Debe confirmar la reunión agendada",
        check: (turns) => replyContainsAny(turns, "agende", "solicitud de reunion", "te contactar")
      },
      {
        id: "no_cotizacion_intake",
        description: "No debe usar next_intake_question para una reunión directa",
        check: (turns) => !anyToolCalled(turns, "next_intake_question")
      }
    ]
  },

  // ── 10. SEGUIMIENTO: proyecto urgente ────────────────────────────────────
  {
    id: "seguimiento_urgente",
    name: "Seguimiento urgente de proyecto",
    description: "Usuario pide respuesta urgente del equipo sobre su proyecto.",
    case_type: "seguimiento",
    phone: "+573001000010",
    turns: [
      { user: "Necesito que el equipo me responda sobre el proyecto Pandapan, es urgente" },
      {
        user: "Sí, por favor registra el seguimiento",
        check: {
          tools_called: ["register_project_followup"]
        }
      }
    ],
    assertions: [
      {
        id: "tool_followup",
        description: "Debe llamar register_project_followup",
        check: (turns) => anyToolCalled(turns, "register_project_followup")
      },
      {
        id: "outcome_followup",
        description: "Debe confirmar que el seguimiento fue registrado",
        check: (turns) => replyContainsAny(turns, "seguimiento", "equipo", "registr", "responder")
      },
      {
        id: "no_cotizacion",
        description: "No debe iniciar flujo de cotización en un seguimiento",
        check: (turns) =>
          !replyContainsAny(turns, "nombre de tu empresa", "tipo de proyecto necesitas")
      }
    ]
  },

  // ── 11. GENERAL: pregunta sobre servicios ─────────────────────────────────
  {
    id: "general_services_query",
    name: "Pregunta general sobre servicios",
    description: "Usuario pregunta qué servicios ofrece LUXISOFT.",
    case_type: "general",
    phone: "+573001000011",
    turns: [{ user: "Hola, qué servicios ofrece LUXISOFT?" }],
    assertions: [
      {
        id: "mentions_services",
        description: "Debe mencionar al menos un servicio de LUXISOFT",
        check: (turns) =>
          replyContainsAny(
            turns,
            "pagina web",
            "ecommerce",
            "app",
            "inteligencia artificial",
            "automatizacion"
          )
      },
      {
        id: "no_ticket",
        description: "No debe abrir ticket ni reunión en una consulta general",
        check: (turns) => !reachOutcome(turns)
      }
    ]
  }
];

function reachOutcome(turns: TurnRecord[]) {
  return turns.some((t) => t.escalationSent);
}
