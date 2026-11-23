/** Shared text for clients; acknowledgment is required anew on each cloud import. Native review pending. */
export const rosterNotices = {
  cloud: {
    en: 'Early access: names in this file will be sent to a cloud AI service outside the Philippines. Use sample or test names, not a real class list. Choose Clean with AI or Clean without AI.',
    fil: 'Paunang pagsubok ito. Ipapadala sa cloud AI service sa labas ng Pilipinas ang mga pangalan sa file na ito. Mga halimbawang pangalan lang ang gamitin. Huwag gumamit ng totoong listahan ng klase. Piliin ang “Linisin gamit ang AI” o “Linisin nang walang AI”.',
  },
  local: {
    en: 'Tala keeps names, grade groups, optional sex and a teacher-assigned local ID. LRN, birthdates, addresses, guardian and contact details are discarded. AI processing stays on Hiraia’s own servers. Review the list before saving.',
    fil: 'Sine-save ng Tala ang pangalan, baitang, kasarian kung inilagay, at lokal na ID na itinakda ng guro. Inaalis ang LRN, petsa ng kapanganakan, tirahan, impormasyon ng tagapag-alaga, at contact details. Sa mga server mismo ng Hiraia pinoproseso ng AI ang listahan. Suriin ang listahan bago i-save.',
  },
  rules: {
    en: 'Tala keeps names, grade groups, optional sex and a teacher-assigned local ID. LRN, birthdates, addresses, guardian and contact details are discarded. No names are sent to an AI service. Review the list before saving.',
    fil: 'Sine-save ng Tala ang pangalan, baitang, kasarian kung inilagay, at lokal na ID na itinakda ng guro. Inaalis ang LRN, petsa ng kapanganakan, tirahan, impormasyon ng tagapag-alaga, at contact details. Walang pangalang ipapadala sa AI service. Suriin ang listahan bago i-save.',
  },
  cloudHistory: {
    en: 'Cleaned with cloud AI (early access)',
    fil: 'Nilinis gamit ang cloud AI (paunang pagsubok)',
  },
} as const;
