import {
  Body,
  Column,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Img,
  Link,
  Preview,
  Row,
  Section,
  Tailwind,
  Text
} from "@react-email/components";
import tailwindConfig from "../tailwind.config.js";

const BRAND_LOGO_URL =
  "https://imagedelivery.net/juOGhpzwqbGB3xBvV9fTTQ/e0ebede4-9c85-419b-57f6-40d8fc898000/product";
const LEGACY_LOGO_URL = "https://luxisoft.com/logo_white.png";
const BRAND_DARK = "#151c2c";
const BRAND_PRIMARY = "#0d9488";
const BORDER = "#e2e8f0";
const MUTED = "#64748b";
const ZEBRA = "#f8fafc";

export type LuxisoftEmailSection = {
  title: string;
  rows: Array<{ label: string; value: string }>;
};

export type LuxisoftEmailHighlight = {
  label: string;
  value: string;
  hint?: string;
};

export type LuxisoftEmailTemplateProps = {
  preview: string;
  title: string;
  subtitle?: string;
  intro?: string;
  reportDateLabel?: string;
  logoUrl: string;
  highlights?: LuxisoftEmailHighlight[];
  sections: LuxisoftEmailSection[];
  notes?: string[];
};

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

function HighlightsBand({ highlights }: { highlights: LuxisoftEmailHighlight[] }) {
  // Hasta 4 tarjetas por fila; cada tarjeta usa el mismo ancho para alinear.
  const rows = chunk(highlights, 4);
  return (
    <Section className="mb-6">
      {rows.map((group, rowIndex) => {
        const width = `${Math.floor(100 / group.length)}%`;
        return (
          <Row key={`hl-${rowIndex}`}>
            {group.map((item, index) => (
              <Column
                key={`${item.label}-${index}`}
                style={{ width, paddingRight: index < group.length - 1 ? 8 : 0 }}
                valign="top"
              >
                <Section
                  className="rounded-lg px-3 py-3"
                  style={{ backgroundColor: ZEBRA, border: `1px solid ${BORDER}` }}
                >
                  <Text
                    className="m-0 text-[22px] font-bold leading-[26px]"
                    style={{ color: BRAND_DARK }}
                  >
                    {item.value}
                  </Text>
                  <Text
                    className="m-0 mt-1 text-[11px] font-semibold uppercase tracking-wide"
                    style={{ color: BRAND_PRIMARY }}
                  >
                    {item.label}
                  </Text>
                  {item.hint ? (
                    <Text className="m-0 mt-1 text-[11px]" style={{ color: MUTED }}>
                      {item.hint}
                    </Text>
                  ) : null}
                </Section>
              </Column>
            ))}
          </Row>
        );
      })}
    </Section>
  );
}

export function LuxisoftEmailTemplate(props: LuxisoftEmailTemplateProps) {
  const requestedLogoUrl = String(props.logoUrl ?? "").trim();
  const resolvedLogoUrl =
    !requestedLogoUrl || requestedLogoUrl === LEGACY_LOGO_URL ? BRAND_LOGO_URL : requestedLogoUrl;
  const highlights = props.highlights?.filter((item) => item && item.value) ?? [];

  return (
    <Html>
      <Head />
      <Tailwind config={tailwindConfig as any}>
        <Body className="bg-[#f1f5f9] font-sans mx-auto my-0">
          <Preview>{props.preview}</Preview>
          <Container className="mx-auto my-0 py-6 px-5 max-w-[680px]">
            <Section
              className="rounded-t-xl px-6 py-6"
              style={{
                background: `linear-gradient(135deg, ${BRAND_DARK} 0%, #1f2a44 100%)`,
                backgroundColor: BRAND_DARK
              }}
            >
              <Row>
                <Column valign="middle">
                  <Img src={resolvedLogoUrl} width="84" height="84" alt="LuxiSoft" />
                </Column>
                <Column align="right" valign="middle">
                  <Text className="text-[11px] uppercase tracking-wide text-[#94a3b8] m-0">
                    LuxiSoft Reporting
                  </Text>
                  <Text className="text-[13px] font-semibold text-white m-0 mt-1">
                    {props.reportDateLabel
                      ? `Corte: ${props.reportDateLabel}`
                      : "Resumen operativo"}
                  </Text>
                </Column>
              </Row>
            </Section>

            <Section className="bg-white rounded-b-xl px-6 py-7 border border-[#e2e8f0] border-t-0">
              <Heading
                className="text-[26px] font-bold mt-0 mb-2 leading-[32px]"
                style={{ color: BRAND_DARK }}
              >
                {props.title}
              </Heading>
              {props.subtitle ? (
                <Text
                  className="text-[15px] font-semibold mt-0 mb-4"
                  style={{ color: BRAND_PRIMARY }}
                >
                  {props.subtitle}
                </Text>
              ) : null}
              {props.intro ? (
                <Text className="text-[#334155] text-[14px] leading-[21px] mt-0 mb-6">
                  {props.intro}
                </Text>
              ) : null}

              {highlights.length ? <HighlightsBand highlights={highlights} /> : null}

              {props.sections.map((section) => (
                <Section key={section.title} className="mb-6">
                  <Section
                    className="rounded-lg overflow-hidden"
                    style={{ border: `1px solid ${BORDER}` }}
                  >
                    <Row>
                      <Column
                        className="px-4 py-2"
                        style={{
                          backgroundColor: BRAND_DARK,
                          borderLeft: `4px solid ${BRAND_PRIMARY}`
                        }}
                      >
                        <Text className="text-[13px] font-semibold uppercase tracking-wide text-white m-0">
                          {section.title}
                        </Text>
                      </Column>
                    </Row>
                    {section.rows.map((row, rowIndex) => (
                      <Row
                        key={`${section.title}-${row.label}`}
                        style={{
                          backgroundColor: rowIndex % 2 === 1 ? ZEBRA : "#ffffff",
                          borderTop: `1px solid ${BORDER}`
                        }}
                      >
                        <Column className="w-[55%] px-4 py-2" valign="top">
                          <Text className="text-[13px] text-[#475569] m-0">{row.label}</Text>
                        </Column>
                        <Column className="w-[45%] px-4 py-2" align="right" valign="top">
                          <Text
                            className="text-[13px] font-semibold m-0"
                            style={{ color: BRAND_DARK }}
                          >
                            {row.value}
                          </Text>
                        </Column>
                      </Row>
                    ))}
                  </Section>
                </Section>
              ))}

              {props.notes?.length ? (
                <Section
                  className="rounded-lg p-4 mb-6"
                  style={{ backgroundColor: ZEBRA, border: `1px solid ${BORDER}` }}
                >
                  <Text
                    className="text-[13px] font-semibold uppercase tracking-wide mt-0 mb-2"
                    style={{ color: BRAND_DARK }}
                  >
                    Detalle
                  </Text>
                  {props.notes.map((note, index) => (
                    <Text
                      key={`${index}-${note}`}
                      className="text-[13px] text-[#334155] leading-[19px] mt-0 mb-1"
                    >
                      {note}
                    </Text>
                  ))}
                </Section>
              ) : null}

              <Hr className="my-4" style={{ borderColor: BORDER }} />
              <Section>
                <Text className="text-[11px] leading-[16px] mt-0 mb-2" style={{ color: MUTED }}>
                  Reporte generado automáticamente por el sistema de WhatsApp de LuxiSoft. Este
                  correo contiene información operativa interna.
                </Text>
                <Link
                  className="underline text-[12px] font-semibold"
                  style={{ color: BRAND_PRIMARY }}
                  href="https://luxisoft.com"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  luxisoft.com
                </Link>
              </Section>
            </Section>
          </Container>
        </Body>
      </Tailwind>
    </Html>
  );
}

export default LuxisoftEmailTemplate;
