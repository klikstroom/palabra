// Spaanse werkwoorden voor de vervoegingstrainer.
// Regelmatige vormen worden berekend; afwijkingen staan per werkwoord als optie.
//   sc: klinkerwisseling in de stam (ie, ue, i, of 'uue' voor jugar)
//   yo: afwijkende ik-vorm in de tegenwoordige tijd
//   pres / pret / imp: volledige rij (6 vormen, gescheiden door spaties)
//   pret3: stamwisseling in 3e persoon verleden tijd bij -ir (i of u)
//   y: leer-type verleden tijd (leyó, leyeron)
//   part: afwijkend voltooid deelwoord

export const PERSONS = ['yo', 'tú', 'él / ella / usted', 'nosotros', 'vosotros', 'ellos / ustedes'];

export const TENSES = {
  pres: { name: 'Presente', nl: 'tegenwoordige tijd', hint: 'ik wil, ik spreek' },
  pret: { name: 'Pretérito indefinido', nl: 'verleden tijd (afgerond)', hint: 'ik ging, ik heb gezegd' },
  imp: { name: 'Imperfecto', nl: 'verleden tijd (beschrijving, gewoonte)', hint: 'ik was altijd, ik ging vroeger' },
  perf: { name: 'Pretérito perfecto', nl: 'voltooide tijd', hint: 'ik heb gegeten' },
};

const END = {
  pres: { ar: ['o', 'as', 'a', 'amos', 'áis', 'an'], er: ['o', 'es', 'e', 'emos', 'éis', 'en'], ir: ['o', 'es', 'e', 'imos', 'ís', 'en'] },
  pret: { ar: ['é', 'aste', 'ó', 'amos', 'asteis', 'aron'], er: ['í', 'iste', 'ió', 'imos', 'isteis', 'ieron'], ir: ['í', 'iste', 'ió', 'imos', 'isteis', 'ieron'] },
  imp: { ar: ['aba', 'abas', 'aba', 'ábamos', 'abais', 'aban'], er: ['ía', 'ías', 'ía', 'íamos', 'íais', 'ían'], ir: ['ía', 'ías', 'ía', 'íamos', 'íais', 'ían'] },
};
const HABER = ['he', 'has', 'ha', 'hemos', 'habéis', 'han'];

// Vervang de laatste klinker `from` in de stam door `to` (quer → quier).
function swap(stem, from, to) {
  const i = stem.lastIndexOf(from);
  return i < 0 ? stem : stem.slice(0, i) + to + stem.slice(i + 1);
}
const SC = { ie: (s) => swap(s, 'e', 'ie'), ue: (s) => swap(s, 'o', 'ue'), i: (s) => swap(s, 'e', 'i'), uue: (s) => swap(s, 'u', 'ue') };

function verb(inf, nl, o = {}) {
  const cls = inf.slice(-2);
  const stem = inf.slice(0, -2);
  const pres = o.pres ? o.pres.split(' ') :
    END.pres[cls].map((e, i) => (o.sc && i !== 3 && i !== 4 ? SC[o.sc](stem) : stem) + e);
  if (o.yo) pres[0] = o.yo;

  let pret;
  if (o.pret) pret = o.pret.split(' ');
  else if (o.y) pret = ['í', 'íste', 'yó', 'ímos', 'ísteis', 'yeron'].map((e) => stem + e);
  else {
    pret = END.pret[cls].map((e) => stem + e);
    if (cls === 'ar') {
      if (stem.endsWith('c')) pret[0] = stem.slice(0, -1) + 'qué';
      else if (stem.endsWith('g')) pret[0] = stem + 'ué';
      else if (stem.endsWith('z')) pret[0] = stem.slice(0, -1) + 'cé';
    }
    if (o.pret3) {
      const s3 = o.pret3 === 'i' ? swap(stem, 'e', 'i') : swap(stem, 'o', 'u');
      pret[2] = s3 + 'ió';
      pret[5] = s3 + 'ieron';
    }
  }
  const imp = o.imp ? o.imp.split(' ') : END.imp[cls].map((e) => stem + e);
  const part = o.part || stem + (cls === 'ar' ? 'ado' : 'ido');
  return { inf, nl, part, forms: { pres, pret, imp, perf: HABER.map((h) => `${h} ${part}`) } };
}

export default [
  verb('ser', 'zijn (wezen)', { pres: 'soy eres es somos sois son', pret: 'fui fuiste fue fuimos fuisteis fueron', imp: 'era eras era éramos erais eran' }),
  verb('estar', 'zijn (toestand, plaats)', { pres: 'estoy estás está estamos estáis están', pret: 'estuve estuviste estuvo estuvimos estuvisteis estuvieron' }),
  verb('tener', 'hebben', { pres: 'tengo tienes tiene tenemos tenéis tienen', pret: 'tuve tuviste tuvo tuvimos tuvisteis tuvieron' }),
  verb('ir', 'gaan', { pres: 'voy vas va vamos vais van', pret: 'fui fuiste fue fuimos fuisteis fueron', imp: 'iba ibas iba íbamos ibais iban' }),
  verb('hacer', 'doen, maken', { yo: 'hago', pret: 'hice hiciste hizo hicimos hicisteis hicieron', part: 'hecho' }),
  verb('poder', 'kunnen', { sc: 'ue', pret: 'pude pudiste pudo pudimos pudisteis pudieron' }),
  verb('querer', 'willen', { sc: 'ie', pret: 'quise quisiste quiso quisimos quisisteis quisieron' }),
  verb('hablar', 'spreken'),
  verb('decir', 'zeggen', { pres: 'digo dices dice decimos decís dicen', pret: 'dije dijiste dijo dijimos dijisteis dijeron', part: 'dicho' }),
  verb('saber', 'weten', { yo: 'sé', pret: 'supe supiste supo supimos supisteis supieron' }),
  verb('venir', 'komen', { pres: 'vengo vienes viene venimos venís vienen', pret: 'vine viniste vino vinimos vinisteis vinieron' }),
  verb('comer', 'eten'),
  verb('vivir', 'wonen, leven'),
  verb('ver', 'zien', { pres: 'veo ves ve vemos veis ven', pret: 'vi viste vio vimos visteis vieron', imp: 'veía veías veía veíamos veíais veían', part: 'visto' }),
  verb('dar', 'geven', { pres: 'doy das da damos dais dan', pret: 'di diste dio dimos disteis dieron' }),
  verb('trabajar', 'werken'),
  verb('poner', 'leggen, zetten', { yo: 'pongo', pret: 'puse pusiste puso pusimos pusisteis pusieron', part: 'puesto' }),
  verb('salir', 'weggaan, uitgaan', { yo: 'salgo' }),
  verb('llegar', 'aankomen'),
  verb('pensar', 'denken', { sc: 'ie' }),
  verb('volver', 'terugkomen', { sc: 'ue', part: 'vuelto' }),
  verb('dormir', 'slapen', { sc: 'ue', pret3: 'u' }),
  verb('pedir', 'vragen om, bestellen', { sc: 'i', pret3: 'i' }),
  verb('conocer', 'kennen', { yo: 'conozco' }),
  verb('entender', 'begrijpen', { sc: 'ie' }),
  verb('encontrar', 'vinden', { sc: 'ue' }),
  verb('llevar', 'dragen, meenemen'),
  verb('tomar', 'nemen, drinken'),
  verb('beber', 'drinken'),
  verb('escribir', 'schrijven', { part: 'escrito' }),
  verb('leer', 'lezen', { y: true, part: 'leído' }),
  verb('pagar', 'betalen'),
  verb('buscar', 'zoeken'),
  verb('empezar', 'beginnen', { sc: 'ie' }),
  verb('jugar', 'spelen', { sc: 'uue' }),
  verb('seguir', 'volgen, doorgaan', { sc: 'i', yo: 'sigo', pret3: 'i' }),
  verb('sentir', 'voelen', { sc: 'ie', pret3: 'i' }),
  verb('preferir', 'liever hebben', { sc: 'ie', pret3: 'i' }),
  verb('abrir', 'openen', { part: 'abierto' }),
  verb('cerrar', 'sluiten', { sc: 'ie' }),
  verb('comprar', 'kopen'),
  verb('necesitar', 'nodig hebben'),
  verb('esperar', 'wachten, hopen'),
  verb('llamar', 'bellen, roepen'),
  verb('aprender', 'leren'),
  verb('creer', 'geloven, denken', { y: true, part: 'creído' }),
  verb('traer', 'brengen', { yo: 'traigo', pret: 'traje trajiste trajo trajimos trajisteis trajeron', part: 'traído' }),
  verb('oír', 'horen', { pres: 'oigo oyes oye oímos oís oyen', pret: 'oí oíste oyó oímos oísteis oyeron', imp: 'oía oías oía oíamos oíais oían', part: 'oído' }),
  verb('recordar', 'zich herinneren', { sc: 'ue' }),
  verb('repetir', 'herhalen', { sc: 'i', pret3: 'i' }),
  verb('conducir', 'autorijden', { yo: 'conduzco', pret: 'conduje condujiste condujo condujimos condujisteis condujeron' }),
  verb('viajar', 'reizen'),
  verb('estudiar', 'studeren'),
];
