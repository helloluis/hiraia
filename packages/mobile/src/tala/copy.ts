import type { Language } from '@hiraia/shared';

const copy = {
  english: {
    title: 'Hiraia Tala',
    join: 'Join Hiraia Tala / Scan teacher QR',
    scan: 'Scan QR',
    enterCode: 'Enter code instead',
    codeHint: 'Type the 12-character code on the teacher phone (XXXX-XXXX-XXXX).',
    codeInvalid: 'That code is not valid. Check the teacher phone and try again.',
    codeExpired: 'That code expired or is wrong. Ask the teacher to show a new one, then retry.',
    leave: 'Leave class / Stop sharing',
    leaveConfirm:
      'This phone will stop sending activity to that teacher. Data already on the teacher phone is not erased.',
    rebind:
      'This phone is already sharing with another teacher. Switch? Unsent activity for the previous teacher will be discarded.',
    disclose:
      'Scanning lets that teacher phone receive this phone’s learning activity and the student names saved on this phone. Hiraia’s online service still does not receive names.',
    sync: 'Sync now',
    searching: 'Searching for the teacher phone…',
    connected: 'Connected',
    sending: 'Sending activity…',
    synced: 'Synced. This phone keeps looking while Hiraia is open.',
    idle: 'Ready. While Hiraia is open, this phone looks for the teacher on its own. You do not need to tap again. The teacher still taps Collect activity.',
    unbound: 'Not in a class. Scan the class QR, or enter the code on the teacher phone. The teacher assigns groups later.',
    playServices: 'Google Play services are required for classroom sync.',
    permission: 'Allow Nearby, Bluetooth, location, and camera so this phone can find the teacher.',
    nearby: 'Could not start Nearby. Check Bluetooth and Wi-Fi, then retry.',
    invalid: 'That QR is not a Hiraia Tala class code.',
    cancel: 'Cancel',
    confirm: 'Continue',
    leaveBtn: 'Stop sharing',
  },
  tagalog: {
    title: 'Hiraia Tala',
    join: 'Sumali sa Hiraia Tala / I-scan ang QR ng guro',
    scan: 'I-scan ang QR',
    enterCode: 'Maglagay ng code',
    codeHint: 'I-type ang 12-titik na code sa telepono ng guro (XXXX-XXXX-XXXX).',
    codeInvalid: 'Hindi wasto ang code. Tingnan ang telepono ng guro at subukan muli.',
    codeExpired: 'Expired o mali ang code. Hingin sa guro ang bagong code, saka subukan muli.',
    leave: 'Umalis sa klase / Itigil ang pagbabahagi',
    leaveConfirm:
      'Hihinto ang teleponong ito sa pagpapadala ng activity sa gurong iyon. Hindi mabubura ang datos na nasa telepono na ng guro.',
    rebind:
      'May ibang gurong nakakabit na sa teleponong ito. Palitan? Ang hindi pa naipadalang activity para sa dating guro ay mawawala.',
    disclose:
      'Kapag ni-scan, puwedeng matanggap ng telepono ng gurong iyon ang learning/activity telemetry ng teleponong ito at ang mga pangalang naka-save dito. Hindi pa rin tumatanggap ng pangalan ang online na serbisyo ng Hiraia.',
    sync: 'I-sync ngayon',
    searching: 'Naghahanap ng telepono ng guro…',
    connected: 'Nakakonekta',
    sending: 'Ipinapadala ang activity…',
    synced: 'Na-sync. Patuloy ang paghahanap habang bukas ang Hiraia.',
    idle: 'Handa na. Habang bukas ang Hiraia, maghahanap mag-isa ang teleponong ito ng guro. Hindi na kailangang pindutin ulit. Ang Collect activity ay sa guro pa rin.',
    unbound: 'Wala sa klase. I-scan ang QR ng klase, o i-type ang code sa telepono ng guro. Ang guro ang magtatalaga ng grupo mamaya.',
    playServices: 'Kailangan ang Google Play services para sa classroom sync.',
    permission: 'Payagan ang Nearby, Bluetooth, location, at camera para mahanap ang guro.',
    nearby: 'Hindi masimulan ang Nearby. Tingnan ang Bluetooth at Wi-Fi, saka subukan muli.',
    invalid: 'Hindi iyon QR ng Hiraia Tala.',
    cancel: 'Ikansela',
    confirm: 'Magpatuloy',
    leaveBtn: 'Itigil ang pagbabahagi',
  },
  cebuano: {
    title: 'Hiraia Tala',
    join: 'Apil sa Hiraia Tala / I-scan ang QR sa magtutudlo',
    scan: 'I-scan ang QR',
    enterCode: 'Ibutang ang code',
    codeHint: 'I-type ang 12-ka-karakter nga code sa telepono sa magtutudlo (XXXX-XXXX-XXXX).',
    codeInvalid: 'Dili sakto ang code. Tan-awa ang telepono sa magtutudlo ug sulayi pag-usab.',
    codeExpired: 'Expired o sayop ang code. Pangayoa ang bag-ong code, dayon sulayi pag-usab.',
    leave: 'Mobiya sa klase / Hunonga ang pagpaambit',
    leaveConfirm:
      'Mohunong ning telepono sa pagpadala og activity nganha sa magtutudlo. Dili mapapas ang datos nga naa na sa telepono sa magtutudlo.',
    rebind:
      'Naa nay laing magtutudlo nga nakabit niining telepono. Ilisan? Ang wala pa mapadala nga activity sa karaang magtutudlo mawala.',
    disclose:
      'Inig-scan, ang telepono niadtong magtutudlo makadawat sa learning/activity telemetry niining telepono ug sa mga ngalan nga naka-save dinhi. Wala gihapon madawat nga ngalan ang online nga serbisyo sa Hiraia.',
    sync: 'I-sync karon',
    searching: 'Nangita sa telepono sa magtutudlo…',
    connected: 'Nakakonektar',
    sending: 'Gipadala ang activity…',
    synced: 'Na-sync. Magpadayon og pangita samtang abli ang Hiraia.',
    idle: 'Andam na. Samtang abli ang Hiraia, mangita kini sa magtutudlo nga walay laing pindot. Ang Collect activity anaa gihapon sa magtutudlo.',
    unbound: 'Wala sa klase. I-scan ang QR sa klase, o i-type ang code sa telepono sa magtutudlo. Ang magtutudlo mag-assign og grupo unya.',
    playServices: 'Gikinahanglan ang Google Play services para sa classroom sync.',
    permission: 'Tugoti ang Nearby, Bluetooth, location, ug kamera aron makit-an ang magtutudlo.',
    nearby: 'Dili masugdan ang Nearby. Tan-awa ang Bluetooth ug Wi-Fi, dayon sulayi pag-usab.',
    invalid: 'Dili kana QR sa Hiraia Tala.',
    cancel: 'Kanselahon',
    confirm: 'Padayon',
    leaveBtn: 'Hunonga ang pagpaambit',
  },
} as const;

export function talaCopy(language: Language) {
  return copy[language] ?? copy.tagalog;
}
