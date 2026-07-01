// KYC / billing completeness for the campaign flow's soft gate. Pure so it
// unit-tests and is reused by both the flow (nudge) and any future hard gate.
//
// "Soft" means: incomplete KYC never blocks browsing, shortlisting, or even
// sending a proposal — it only surfaces a nudge. addressLine2 is optional.

export type KycFields = {
  businessType: string | null;
  legalName: string | null;
  billingEmail: string | null;
  addressLine1: string | null;
  postalCode: string | null;
  city: string | null;
};

export const KYC_REQUIRED: (keyof KycFields)[] = [
  "businessType",
  "legalName",
  "billingEmail",
  "addressLine1",
  "postalCode",
  "city",
];

export function kycMissingFields(o: KycFields): (keyof KycFields)[] {
  return KYC_REQUIRED.filter((k) => {
    const v = o[k];
    return v == null || String(v).trim() === "";
  });
}

export function kycComplete(o: KycFields): boolean {
  return kycMissingFields(o).length === 0;
}
