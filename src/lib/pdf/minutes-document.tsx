import { Document, Image, Page, StyleSheet, Text, View } from "@react-pdf/renderer";

import type { Minutes } from "@/lib/schemas/minutes";
import type { MeetingDetail, Signature } from "@/lib/types";
import { ACCEPTANCE_TEXT } from "@/lib/consent";
import { formatDate, formatDateTime } from "@/lib/utils";

const NAVY = "#0b1f66";
const INK = "#101828";
const MUTED = "#56607a";
const LINE = "#d7dced";

const styles = StyleSheet.create({
  page: { paddingTop: 44, paddingBottom: 64, paddingHorizontal: 46, fontSize: 9.5, color: INK, lineHeight: 1.5 },
  draftBanner: {
    backgroundColor: "#fdf1e3",
    borderWidth: 1,
    borderColor: "#b25e08",
    color: "#8c4a06",
    padding: 6,
    marginBottom: 12,
    fontSize: 9,
    textAlign: "center",
  },
  header: { borderBottomWidth: 2, borderBottomColor: NAVY, paddingBottom: 8, marginBottom: 14 },
  institution: { fontSize: 12, fontFamily: "Helvetica-Bold", color: NAVY },
  address: { fontSize: 8, color: MUTED, marginTop: 2 },
  title: { fontSize: 14, fontFamily: "Helvetica-Bold", marginTop: 10 },
  code: { fontSize: 8, color: MUTED, marginTop: 2 },
  section: { marginTop: 12 },
  sectionTitle: {
    fontSize: 10,
    fontFamily: "Helvetica-Bold",
    color: NAVY,
    borderBottomWidth: 1,
    borderBottomColor: LINE,
    paddingBottom: 3,
    marginBottom: 5,
  },
  row: { flexDirection: "row", marginBottom: 2 },
  label: { width: 118, color: MUTED },
  value: { flex: 1 },
  item: { marginBottom: 5 },
  itemTitle: { fontFamily: "Helvetica-Bold" },
  meta: { fontSize: 8, color: MUTED, marginTop: 1 },
  bullet: { flexDirection: "row", marginBottom: 3 },
  bulletDot: { width: 10 },
  empty: { color: MUTED, fontStyle: "italic" },
  signatureGrid: { flexDirection: "row", flexWrap: "wrap", marginTop: 8 },
  signatureBox: { width: "50%", paddingRight: 12, marginBottom: 14 },
  signatureImage: { height: 54, marginBottom: 4, objectFit: "contain" },
  signatureLine: { borderTopWidth: 1, borderTopColor: INK, paddingTop: 3 },
  declaration: { fontSize: 8, color: MUTED, marginTop: 6, lineHeight: 1.4 },
  footer: {
    position: "absolute",
    bottom: 26,
    left: 46,
    right: 46,
    borderTopWidth: 1,
    borderTopColor: LINE,
    paddingTop: 5,
    fontSize: 7.5,
    color: MUTED,
  },
  mono: { fontFamily: "Courier", fontSize: 7.5 },
});

const ROLE_LABEL: Record<string, string> = {
  teacher: "Docente",
  representative: "Representante",
  student: "Estudiante",
  other: "Otra persona participante",
};

function Empty() {
  return <Text style={styles.empty}>No consta.</Text>;
}

function Bullets({ items }: { items: string[] }) {
  if (items.length === 0) return <Empty />;
  return (
    <>
      {items.map((item, index) => (
        <View key={index} style={styles.bullet}>
          <Text style={styles.bulletDot}>•</Text>
          <Text style={{ flex: 1 }}>{item}</Text>
        </View>
      ))}
    </>
  );
}

export interface MinutesPdfProps {
  detail: MeetingDetail;
  content: Minutes;
  acceptedLanguageFlags: Minutes["language_flags"];
  signatures: Signature[];
  documentCode: string;
  version: number;
  approved: boolean;
  generatedAt: string;
  /**
   * Huella del contenido del acta (JSON canónico de la versión aprobada).
   * No es la huella del archivo PDF: esa se calcula sobre los bytes ya
   * generados y no puede imprimirse dentro del propio archivo. Ambas se
   * conservan y se muestran por separado en el repositorio.
   */
  contentSha256: string;
  generator: "anthropic" | "demo";
}
export function MinutesDocument({
  detail,
  content,
  acceptedLanguageFlags,
  signatures,
  documentCode,
  version,
  approved,
  generatedAt,
  contentSha256,
  generator,
}: MinutesPdfProps) {
  const { meeting, student, institution, participants } = detail;

  return (
    <Document
      title={`${documentCode} — ${meeting.title}`}
      author={institution.name}
      subject="Acta de reunión escolar"
      creator="ACTA PRO"
      producer="ACTA PRO"
      // Los metadatos del PDF también se fijan. Si la fecha de creación la
      // pusiera el reloj, los bytes diferirían en cada generación y el
      // SHA-256 del archivo dejaría de ser reproducible.
      creationDate={new Date(generatedAt)}
      modificationDate={new Date(generatedAt)}
    >
      <Page size="A4" style={styles.page}>
        {!approved ? (
          <Text style={styles.draftBanner}>
            BORRADOR — documento sin aprobación humana. No debe utilizarse como evidencia institucional.
          </Text>
        ) : null}

        <View style={styles.header}>
          <Text style={styles.institution}>{institution.name}</Text>
          {institution.address ? <Text style={styles.address}>{institution.address}</Text> : null}
          <Text style={styles.title}>Acta de reunión — {meeting.title}</Text>
          <Text style={styles.code}>
            Código del documento: {documentCode} · Versión {version}
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>1. Identificación de la reunión</Text>
          <View style={styles.row}>
            <Text style={styles.label}>Fecha y hora</Text>
            <Text style={styles.value}>{formatDateTime(meeting.scheduled_at ?? meeting.created_at)}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Modalidad</Text>
            <Text style={styles.value}>Presencial, con grabación de audio autorizada</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Inicio de grabación</Text>
            <Text style={styles.value}>
              {meeting.started_at ? formatDateTime(meeting.started_at) : "No consta"}
            </Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>2. Datos del estudiante</Text>
          <View style={styles.row}>
            <Text style={styles.label}>Nombre</Text>
            <Text style={styles.value}>{student.full_name}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Curso</Text>
            <Text style={styles.value}>
              {student.grade ?? "No consta"} {student.section ?? ""}
            </Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Código interno</Text>
            <Text style={styles.value}>{student.external_id ?? "No consta"}</Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>3. Participantes y consentimiento</Text>
          {participants.length === 0 ? (
            <Empty />
          ) : (
            participants.map((participant) => (
              <View key={participant.id} style={styles.row}>
                <Text style={styles.label}>{ROLE_LABEL[participant.participant_type] ?? "Participante"}</Text>
                <Text style={styles.value}>
                  {participant.display_name} —{" "}
                  {participant.consent_status === "granted"
                    ? `consentimiento otorgado el ${formatDate(participant.consent_at)} (texto ${participant.consent_text_version ?? "no consta"})`
                    : "sin consentimiento registrado"}
                </Text>
              </View>
            ))
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>4. Motivo de la reunión</Text>
          <Text>{content.meeting_reason ?? meeting.reason ?? "No consta."}</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>5. Resumen</Text>
          <Text>{content.summary || "No consta."}</Text>
        </View>

        <View style={styles.section} break={false}>
          <Text style={styles.sectionTitle}>6. Temas tratados</Text>
          {content.topics.length === 0 ? (
            <Empty />
          ) : (
            content.topics.map((topic, index) => (
              <View key={index} style={styles.item}>
                <Text style={styles.itemTitle}>
                  {index + 1}. {topic.title}
                </Text>
                <Text>{topic.description}</Text>
              </View>
            ))
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>7. Hechos mencionados</Text>
          <Text style={styles.meta}>
            Se registran como afirmaciones expresadas durante la reunión y atribuidas a quien las manifestó. No
            constituyen hechos verificados por la institución.
          </Text>
          {content.facts.length === 0 ? (
            <Empty />
          ) : (
            content.facts.map((fact, index) => (
              <View key={index} style={styles.item}>
                <Text>• {fact.statement}</Text>
                <Text style={styles.meta}>Manifestado por: {fact.attributed_to}</Text>
              </View>
            ))
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>8. Acuerdos</Text>
          {content.agreements.length === 0 ? (
            <Empty />
          ) : (
            content.agreements.map((agreement, index) => (
              <View key={index} style={styles.item}>
                <Text>
                  {index + 1}. {agreement.description}
                </Text>
                <Text style={styles.meta}>
                  Responsable: {agreement.responsible ?? "No consta"} · Fecha:{" "}
                  {agreement.due_date ? formatDate(agreement.due_date) : "No consta"}
                </Text>
              </View>
            ))
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>9. Compromisos</Text>
          {content.commitments.length === 0 ? (
            <Empty />
          ) : (
            content.commitments.map((commitment, index) => (
              <View key={index} style={styles.item}>
                <Text>
                  {index + 1}. {commitment.description}
                </Text>
                <Text style={styles.meta}>
                  Responsable: {commitment.responsible ?? "No consta"} · Fecha:{" "}
                  {commitment.due_date ? formatDate(commitment.due_date) : "No consta"}
                </Text>
              </View>
            ))
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>10. Seguimiento</Text>
          {content.follow_up.length === 0 ? (
            <Empty />
          ) : (
            content.follow_up.map((item, index) => (
              <View key={index} style={styles.item}>
                <Text>
                  {index + 1}. {item.action}
                </Text>
                <Text style={styles.meta}>Fecha: {item.date ? formatDate(item.date) : "No consta"}</Text>
              </View>
            ))
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>11. Asuntos pendientes</Text>
          <Bullets items={content.pending_items} />
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>12. Discrepancias registradas</Text>
          <Text style={styles.meta}>
            Versiones distintas expresadas en la reunión. Se dejan constar sin que la institución determine cuál
            prevalece.
          </Text>
          <Bullets items={content.contradictions} />
        </View>

        {acceptedLanguageFlags.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>13. Precisiones de lenguaje aceptadas</Text>
            <Text style={styles.meta}>
              Reformulaciones objetivas aceptadas por la persona docente. La transcripción original no fue
              modificada.
            </Text>
            {acceptedLanguageFlags.map((flag, index) => (
              <View key={index} style={styles.item}>
                <Text>• {flag.objective_suggestion}</Text>
                <Text style={styles.meta}>Motivo del ajuste: {flag.reason}</Text>
              </View>
            ))}
          </View>
        ) : null}

        <View style={styles.section} wrap={false}>
          <Text style={styles.sectionTitle}>Declaración de revisión y aprobación</Text>
          <Text>
            {approved
              ? "La persona docente responsable revisó el contenido de esta acta y lo aprobó antes de su firma. El borrador fue producido con apoyo automatizado y sometido a revisión humana."
              : "Este documento aún no cuenta con aprobación humana."}
          </Text>
          <Text style={styles.declaration}>{ACCEPTANCE_TEXT}</Text>
        </View>

        <View style={styles.section} wrap={false}>
          <Text style={styles.sectionTitle}>Firmas</Text>
          {signatures.length === 0 ? (
            <Empty />
          ) : (
            <View style={styles.signatureGrid}>
              {signatures.map((signature) => (
                <View key={signature.id} style={styles.signatureBox}>
                  {/* eslint-disable-next-line jsx-a11y/alt-text -- Image de @react-pdf/renderer no acepta alt; el nombre de quien firma aparece debajo. */}
                  <Image src={signature.signature_path} style={styles.signatureImage} />
                  <View style={styles.signatureLine}>
                    <Text style={styles.itemTitle}>{signature.signer_name}</Text>
                    <Text style={styles.meta}>
                      {ROLE_LABEL[signature.signer_role] ?? "Participante"} ·{" "}
                      {formatDateTime(signature.signed_at)}
                    </Text>
                    <Text style={styles.meta}>
                      Firma manuscrita digitalizada · texto {signature.acceptance_text_version}
                    </Text>
                  </View>
                </View>
              ))}
            </View>
          )}
        </View>

        <View style={styles.footer} fixed>
          <Text>
            {documentCode} · versión {version} · generado el {formatDateTime(generatedAt)} ·{" "}
            {generator === "anthropic" ? "borrador asistido por IA revisado por la docente" : "borrador de demostración"}
          </Text>
          <Text style={styles.mono}>SHA-256 del contenido: {contentSha256}</Text>
          <Text>
            Evidencia institucional trazable. La firma manuscrita digitalizada no equivale a una firma electrónica
            cualificada.
          </Text>
        </View>
      </Page>
    </Document>
  );
}
