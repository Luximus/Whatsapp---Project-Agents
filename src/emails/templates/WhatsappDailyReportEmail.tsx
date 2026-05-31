import LuxisoftEmailTemplate, {
  type LuxisoftEmailHighlight,
  type LuxisoftEmailSection
} from "./LuxisoftEmailTemplate.js";

export type WhatsappDailyReportEmailProps = {
  reportDate: string;
  logoUrl: string;
  sections: LuxisoftEmailSection[];
  highlights?: LuxisoftEmailHighlight[];
  notes?: string[];
};

export function WhatsappDailyReportEmail(props: WhatsappDailyReportEmailProps) {
  return (
    <LuxisoftEmailTemplate
      preview={`Reporte diario WhatsApp · ${props.reportDate}`}
      title={`Reporte WhatsApp · ${props.reportDate}`}
      subtitle="Resumen operativo diario"
      intro="Consolidado de interacciones de WhatsApp, consumo de IA y solicitudes comerciales para análisis y seguimiento del equipo de LuxiSoft."
      reportDateLabel={props.reportDate}
      logoUrl={props.logoUrl}
      highlights={props.highlights}
      sections={props.sections}
      notes={props.notes}
    />
  );
}

export default WhatsappDailyReportEmail;
