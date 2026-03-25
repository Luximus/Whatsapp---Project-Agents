import LuxisoftEmailTemplate, { type LuxisoftEmailSection } from "./LuxisoftEmailTemplate.js";

export type WhatsappDailyReportEmailProps = {
  reportDate: string;
  logoUrl: string;
  sections: LuxisoftEmailSection[];
  notes?: string[];
};

export function WhatsappDailyReportEmail(props: WhatsappDailyReportEmailProps) {
  return (
    <LuxisoftEmailTemplate
      preview={`Reporte diario WhatsApp - ${props.reportDate}`}
      title={`Report WhatsApp - ${props.reportDate}`}
      subtitle="Resumen operativo diario"
      intro="Consolidado de interacciones de WhatsApp, consumo OpenAI y solicitudes comerciales para analisis y seguimiento del equipo de LuxiSoft."
      reportDateLabel={props.reportDate}
      logoUrl={props.logoUrl}
      sections={props.sections}
      notes={props.notes}
    />
  );
}

export default WhatsappDailyReportEmail;
