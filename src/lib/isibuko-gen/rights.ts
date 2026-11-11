export type RightsBasis = "isibuko-owned" | "commercially-licensed";
export type RecordKind = "synthetic-fixture" | "real";
export type AgreementScope = "ai-training" | "product-use";

export type RightsRecord = {
  recordKind: RecordKind | null;
  rightsBasis: RightsBasis | null;
  rightsHolder: string;
  agreementReference: string;
  agreementScope: AgreementScope | null;
  commercialTraining: boolean | null;
  consentId: string;
  allowsTraining: boolean | null;
  allowsPersonImagery: boolean | null;
  source: string;
  acquired: string;
  method: string;
  merchant: string;
};

export type AdmissionLabel = "Draft" | "Rights incomplete" | "Awaiting independent review" | "Rejected" | "Eligible for admission" | "Admitted";

export function emptyRights(): RightsRecord {
  return {
    recordKind: null,
    rightsBasis: null,
    rightsHolder: "",
    agreementReference: "",
    agreementScope: null,
    commercialTraining: null,
    consentId: "",
    allowsTraining: null,
    allowsPersonImagery: null,
    source: "",
    acquired: "",
    method: "",
    merchant: "",
  };
}

export function rightsProblems(rights: RightsRecord | null | undefined) {
  const record = rights ?? emptyRights();
  const reasons: string[] = [];
  if (record.rightsBasis !== "isibuko-owned" && record.rightsBasis !== "commercially-licensed") {
    reasons.push("Rights basis must be isibuko-owned or commercially-licensed.");
  }
  if (!record.rightsHolder.trim()) reasons.push("A rights holder is missing.");
  if (!record.agreementReference.trim()) reasons.push("A licence or agreement reference is missing.");
  if (record.agreementScope === "product-use") reasons.push("A product-use licence is not an AI-training licence.");
  else if (record.agreementScope !== "ai-training") reasons.push("The agreement scope must say ai-training. It was not assumed.");
  if (record.commercialTraining !== true) reasons.push("Commercial training is not permitted.");
  if (!record.consentId.trim()) reasons.push("A consent record id is missing.");
  if (record.allowsTraining !== true) reasons.push("Training consent is missing or not granted.");
  if (record.allowsPersonImagery !== true && record.allowsPersonImagery !== false) {
    reasons.push("Person-imagery permission is missing. Garment permission does not include it.");
  }
  if (record.allowsTraining === true && record.commercialTraining === false) {
    reasons.push("Training consent contradicts the commercial-training permission.");
  }
  if (!record.source.trim() || !record.acquired.trim()) reasons.push("Provenance needs a source and an acquired date.");
  if (!record.method.trim()) reasons.push("The acquisition method is missing.");
  if (!record.merchant.trim()) reasons.push("The merchant is missing.");
  if (record.recordKind !== "synthetic-fixture" && record.recordKind !== "real") {
    reasons.push("The record must say whether it is a synthetic fixture or a real sample.");
  }
  return reasons;
}

export function sampleStatus(input: {
  sku: string;
  category: string | null;
  annotator: string;
  reviewer: string;
  review?: string;
  admitted?: boolean;
  geometryOpen: boolean;
  rights: RightsRecord | null | undefined;
}) {
  const reasons = rightsProblems(input.rights);
  const untouched = !input.sku.trim() && !input.category && !input.rights?.rightsBasis && !input.rights?.rightsHolder.trim();
  if (untouched) return { status: "draft", label: "Draft" as AdmissionLabel, reasons: ["Nothing has been recorded yet."] };
  if (reasons.length) return { status: "rights-incomplete", label: "Rights incomplete" as AdmissionLabel, reasons };
  if (input.geometryOpen) return { status: "rejected", label: "Rejected" as AdmissionLabel, reasons: ["Garment parts are still incomplete."] };
  if (input.rights?.recordKind === "synthetic-fixture") {
    return { status: "rejected", label: "Rejected" as AdmissionLabel, reasons: ["Synthetic fixture cannot enter a training run."] };
  }
  if (!input.reviewer.trim()) {
    return { status: "awaiting-independent-review", label: "Awaiting independent review" as AdmissionLabel, reasons: ["An independent reviewer has not been named."] };
  }
  if (input.reviewer.trim() === input.annotator.trim()) {
    return { status: "rejected", label: "Rejected" as AdmissionLabel, reasons: ["The reviewer must be a different person from the annotator."] };
  }
  if (input.admitted === true && input.review === "approved") return { status: "admitted", label: "Admitted" as AdmissionLabel, reasons: [] };
  if (input.review === "approved") {
    return { status: "eligible-for-admission", label: "Eligible for admission" as AdmissionLabel, reasons: ["An independent reviewer approved the row. Admission has not been recorded."] };
  }
  return {
    status: "awaiting-independent-review",
    label: "Awaiting independent review" as AdmissionLabel,
    reasons: ["The form is complete. It is not approved and it is not admitted."],
  };
}
