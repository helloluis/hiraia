/** Shared text for clients; acknowledgment is required anew on each cloud import. Native review pending. */
export const rosterNotices = {
  cloud: {
    en: 'Early access: names in this file will be sent to a cloud AI service outside the Philippines. Use sample or test names, not a real class list. Choose Clean with AI or Clean without AI.',
    fil: 'Maagang pagsubok: ipapadala ang mga pangalan sa file na ito sa cloud AI service sa labas ng Pilipinas. Gumamit ng mga halimbawang pangalan, hindi ng tunay na listahan ng klase. Piliin ang Linisin gamit ang AI o Linisin nang walang AI.',
  },
  local: {
    en: 'Tala keeps names, grade groups, optional sex and a teacher-assigned local ID. LRN, birthdates, addresses, guardian and contact details are discarded. AI processing stays on Hiraia’s own servers. Review the list before saving.',
    fil: 'Itinatago ng Tala ang mga pangalan, baitang, opsyonal na kasarian at lokal na ID na itinalaga ng guro. Inaalis ang LRN, petsa ng kapanganakan, tirahan, at detalye ng tagapag-alaga at pakikipag-ugnayan. Sa sariling mga server ng Hiraia ginagawa ang pagproseso ng AI. Suriin ang listahan bago i-save.',
  },
  rules: {
    en: 'Tala keeps names, grade groups, optional sex and a teacher-assigned local ID. LRN, birthdates, addresses, guardian and contact details are discarded. No names are sent to an AI service. Review the list before saving.',
    fil: 'Itinatago ng Tala ang mga pangalan, baitang, opsyonal na kasarian at lokal na ID na itinalaga ng guro. Inaalis ang LRN, petsa ng kapanganakan, tirahan, at detalye ng tagapag-alaga at pakikipag-ugnayan. Walang pangalang ipapadala sa AI service. Suriin ang listahan bago i-save.',
  },
  cloudHistory: { en: 'Cleaned with cloud AI (early access)', fil: 'Nilinis gamit ang cloud AI (maagang pagsubok)' },
} as const;
