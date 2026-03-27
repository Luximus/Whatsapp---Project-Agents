import {
  Body,
  Column,
  Container,
  Head,
  Heading,
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

export type LuxisoftEmailSection = {
  title: string;
  rows: Array<{ label: string; value: string }>;
};

export type LuxisoftEmailTemplateProps = {
  preview: string;
  title: string;
  subtitle?: string;
  intro?: string;
  reportDateLabel?: string;
  logoUrl: string;
  sections: LuxisoftEmailSection[];
  notes?: string[];
};

export function LuxisoftEmailTemplate(props: LuxisoftEmailTemplateProps) {
  const requestedLogoUrl = String(props.logoUrl ?? "").trim();
  const resolvedLogoUrl =
    !requestedLogoUrl || requestedLogoUrl === LEGACY_LOGO_URL ? BRAND_LOGO_URL : requestedLogoUrl;

  return (
    <Html>
      <Head />
      <Tailwind config={tailwindConfig as any}>
        <Body className="bg-[#f8fafc] font-sans mx-auto my-0">
          <Preview>{props.preview}</Preview>
          <Container className="mx-auto my-0 py-6 px-5 max-w-[680px]">
            <Section className="rounded-t-xl px-6 py-6" style={{ backgroundColor: BRAND_DARK }}>
              <Row>
                <Column>
                  <Img src={resolvedLogoUrl} width="100" height="100" alt="LuxiSoft" />
                </Column>
                <Column align="right">
                  <Text className="text-xs text-[#cbd5e1] m-0">
                    {props.reportDateLabel ? `Corte: ${props.reportDateLabel}` : "LuxiSoft Reporting"}
                  </Text>
                </Column>
              </Row>
            </Section>

            <Section className="bg-white rounded-b-xl px-6 py-7 border border-[#e2e8f0] border-t-0">
              <Heading className="text-[28px] font-bold mt-0 mb-2 leading-[34px]" style={{ color: BRAND_DARK }}>
                {props.title}
              </Heading>
              {props.subtitle ? (
                <Text className="text-[#0d9488] text-[16px] mt-0 mb-5">{props.subtitle}</Text>
              ) : null}
              {props.intro ? <Text className="text-[#334155] text-[14px] mt-0 mb-6">{props.intro}</Text> : null}

              {props.sections.map((section) => (
                <Section key={section.title} className="mb-6">
                  <Text className="text-[16px] font-semibold mt-0 mb-2" style={{ color: BRAND_DARK }}>
                    {section.title}
                  </Text>
                  <Section className="rounded-lg border border-[#e2e8f0] p-3">
                    {section.rows.map((row) => (
                      <Row key={`${section.title}-${row.label}`} className="mb-1">
                        <Column className="w-[45%]">
                          <Text className="text-[13px] text-[#475569] m-0">{row.label}</Text>
                        </Column>
                        <Column align="right" className="w-[55%]">
                          <Text className="text-[13px] font-medium m-0" style={{ color: BRAND_DARK }}>
                            {row.value}
                          </Text>
                        </Column>
                      </Row>
                    ))}
                  </Section>
                </Section>
              ))}

              {props.notes?.length ? (
                <Section className="bg-[#f1f5f9] border border-[#cbd5e1] rounded-lg p-4 mb-6">
                  <Text className="text-[14px] font-semibold mt-0 mb-2" style={{ color: BRAND_DARK }}>
                    Notas
                  </Text>
                  {props.notes.map((note, index) => (
                    <Text key={`${index}-${note}`} className="text-[13px] text-[#334155] mt-0 mb-1">
                      - {note}
                    </Text>
                  ))}
                </Section>
              ) : null}

              <Section>
                <Text className="text-xs leading-[16px] text-[#64748b] mt-0 mb-2">
                  Este reporte fue generado automaticamente por el sistema de WhatsApp de LuxiSoft.
                </Text>
                <Link
                  className="text-[#0d9488] underline text-xs"
                  href="https://luxisoft.com/en/"
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
