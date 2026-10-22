// Talen die de app kent. Een nieuwe taal toevoegen = een databestand in
// data/ maken met hetzelfde formaat als data/es.js en hier `load` invullen.
export const LANGS = {
  es: { name: 'Spaans', flag: '🇪🇸', voice: 'es-ES', load: () => import('../data/es.js') },
  it: { name: 'Italiaans', flag: '🇮🇹', voice: 'it-IT', load: null },
  de: { name: 'Duits', flag: '🇩🇪', voice: 'de-DE', load: null },
  fr: { name: 'Frans', flag: '🇫🇷', voice: 'fr-FR', load: null },
};

export const POS = {
  ww: 'werkwoord', zn: 'zelfst. nw.', bn: 'bijv. nw.', bw: 'bijwoord',
  vnw: 'voornaamwoord', vw: 'voegwoord', vz: 'voorzetsel', vr: 'vraagwoord',
  tw: 'telwoord', uitdr: 'uitdrukking', lw: 'lidwoord',
};

// Regels: doeltaal | Nederlands | woordsoort | voorbeeldzin met *vorm* | vertaling | thema | extra
export function parseDeck(text) {
  const words = [];
  const seen = new Set();
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const [term, nl, pos, ex = '', exNl = '', tag = '', extra = ''] = t.split('|').map((s) => s.trim());
    let id = term.toLowerCase();
    while (seen.has(id)) id += '+';
    seen.add(id);
    const m = ex.match(/\*(.+?)\*/);
    words.push({
      id, term, nl, pos, tag, extra, exNl,
      ex: ex.replace(/\*/g, ''),
      exHtml: ex.replace(/\*(.+?)\*/g, '<b>$1</b>'),
      form: m ? m[1] : term,
      gapHtml: m ? ex.replace(/\*(.+?)\*/, '<span class="gap">&nbsp;</span>') : '',
    });
  }
  return words;
}
