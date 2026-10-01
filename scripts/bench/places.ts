/**
 * Where the synthetic benchmark contacts live: real neighbourhoods and real
 * main streets, so a pin lands on land and an address reads like one.
 *
 * The streets, the neighbourhoods and the postcode prefixes are real. The
 * house numbers, the rest of each postcode and every phone number are
 * invented. A contact's pin is placed near the neighbourhood's centre, so it
 * is "in the right part of the city", never a claim that somebody lives at a
 * real door.
 *
 * @module scripts/bench/places
 */
import type { allFakers } from "@faker-js/faker";

/** One neighbourhood: where its centre is, and a main street in it. */
export interface Neighbourhood {
  name: string;
  street: string;
  /** The whole postcode where it is fixed for the area, else its first part. */
  zip: string;
  lat: number;
  lng: number;
}

/** How a country writes an address and a phone number. */
export interface Country {
  /** International dialling code, without the plus. */
  calling: string;
  /** Whether the house number follows the street ("Kastanienallee 12"). */
  numberAfter: boolean;
  /** Whether the postcode comes before the city ("10435 Berlin"). */
  zipFirst: boolean;
  /**
   * The postcode format. `#` is a digit and `A` a letter. A place's prefix
   * takes the place of as many characters at the start, or of the `@` in a
   * format whose first part varies in length ("G1 #AA", "CF10 #AA").
   */
  zip: string;
  /** The faker locale for names and streets, in Latin letters. Else English. */
  locale?: keyof typeof allFakers;
  /**
   * Mobile number patterns. `#` is a digit, `N` a digit from 2 to 9, `@` the
   * city's area code. The digits are random, not the reserved fictional
   * ranges, because a hundred fictional numbers cannot serve thousands of
   * contacts without the duplicate scan reading them as the same person.
   */
  phones: string[];
}

export const COUNTRIES: Record<string, Country> = {
  US: {
    calling: "1",
    numberAfter: false,
    zipFirst: false,
    zip: "#####",
    locale: "en_US",
    phones: ["+1 (@) N##-####"],
  },
  CA: {
    calling: "1",
    numberAfter: false,
    zipFirst: false,
    zip: "A#A #A#",
    locale: "en_CA",
    phones: ["+1 (@) N##-####"],
  },
  GB: {
    calling: "44",
    numberAfter: false,
    zipFirst: false,
    zip: "@ #AA",
    locale: "en_GB",
    phones: ["+44 7### ######"],
  },
  IE: {
    calling: "353",
    numberAfter: false,
    zipFirst: false,
    zip: "A## AA##",
    locale: "en_IE",
    phones: ["+353 83 ### ####", "+353 85 ### ####", "+353 86 ### ####"],
  },
  DE: {
    calling: "49",
    numberAfter: true,
    zipFirst: true,
    zip: "#####",
    locale: "de",
    phones: ["+49 151 ########", "+49 160 ########", "+49 170 ########"],
  },
  FR: {
    calling: "33",
    numberAfter: false,
    zipFirst: true,
    zip: "#####",
    locale: "fr",
    phones: ["+33 6 ## ## ## ##", "+33 7 ## ## ## ##"],
  },
  NL: {
    calling: "31",
    numberAfter: true,
    zipFirst: true,
    zip: "#### AA",
    locale: "nl",
    phones: ["+31 6 ########"],
  },
  PT: {
    calling: "351",
    numberAfter: true,
    zipFirst: true,
    zip: "####-###",
    locale: "pt_PT",
    phones: ["+351 91# ### ###", "+351 93# ### ###"],
  },
  MX: {
    calling: "52",
    numberAfter: true,
    zipFirst: true,
    zip: "#####",
    locale: "es_MX",
    phones: ["+52 55 #### ####"],
  },
  BR: {
    calling: "55",
    numberAfter: true,
    zipFirst: false,
    zip: "#####-###",
    locale: "pt_BR",
    phones: ["+55 11 9#### ####"],
  },
  KE: {
    calling: "254",
    numberAfter: false,
    zipFirst: false,
    zip: "00###",
    phones: ["+254 7## ### ###"],
  },
  NG: {
    calling: "234",
    numberAfter: false,
    zipFirst: false,
    zip: "######",
    locale: "en_NG",
    phones: ["+234 80# ### ####", "+234 81# ### ####"],
  },
  SG: {
    calling: "65",
    numberAfter: false,
    zipFirst: false,
    zip: "######",
    phones: ["+65 8### ####", "+65 9### ####"],
  },
  KR: {
    calling: "82",
    numberAfter: true,
    zipFirst: false,
    zip: "#####",
    phones: ["+82 10 #### ####"],
  },
  JP: {
    calling: "81",
    numberAfter: false,
    zipFirst: false,
    zip: "###-####",
    phones: ["+81 90 #### ####", "+81 80 #### ####"],
  },
  IL: {
    calling: "972",
    numberAfter: true,
    zipFirst: false,
    zip: "#######",
    phones: ["+972 50 ### ####", "+972 52 ### ####", "+972 54 ### ####"],
  },
  SE: {
    calling: "46",
    numberAfter: true,
    zipFirst: true,
    zip: "### ##",
    locale: "sv",
    phones: ["+46 70 ### ## ##", "+46 73 ### ## ##"],
  },
  AU: {
    calling: "61",
    numberAfter: false,
    zipFirst: false,
    zip: "####",
    locale: "en_AU",
    phones: ["+61 4## ### ###"],
  },
  CH: {
    calling: "41",
    numberAfter: true,
    zipFirst: true,
    zip: "####",
    locale: "de_CH",
    phones: ["+41 76 ### ## ##", "+41 79 ### ## ##"],
  },
  IN: {
    calling: "91",
    numberAfter: false,
    zipFirst: false,
    zip: "######",
    locale: "en_IN",
    phones: ["+91 98### #####", "+91 99### #####"],
  },
  DK: {
    calling: "45",
    numberAfter: true,
    zipFirst: true,
    zip: "####",
    locale: "da",
    phones: ["+45 ## ## ## ##"],
  },
  BE: {
    calling: "32",
    numberAfter: true,
    zipFirst: true,
    zip: "####",
    locale: "nl_BE",
    phones: ["+32 4## ## ## ##"],
  },
  GR: {
    calling: "30",
    numberAfter: true,
    zipFirst: true,
    zip: "### ##",
    phones: ["+30 69# ### ####"],
  },
  ES: {
    calling: "34",
    numberAfter: true,
    zipFirst: true,
    zip: "#####",
    locale: "es",
    phones: ["+34 6## ### ###", "+34 7## ### ###"],
  },
  NO: {
    calling: "47",
    numberAfter: true,
    zipFirst: true,
    zip: "####",
    locale: "nb_NO",
    phones: ["+47 4## ## ###", "+47 9## ## ###"],
  },
  IT: {
    calling: "39",
    numberAfter: true,
    zipFirst: true,
    zip: "#####",
    locale: "it",
    phones: ["+39 3## ### ####"],
  },
  SK: {
    calling: "421",
    numberAfter: true,
    zipFirst: true,
    zip: "### ##",
    locale: "sk",
    phones: ["+421 9## ### ###"],
  },
  HU: {
    calling: "36",
    numberAfter: true,
    zipFirst: true,
    zip: "####",
    locale: "hu",
    phones: ["+36 20 ### ####", "+36 30 ### ####"],
  },
  PL: {
    calling: "48",
    numberAfter: true,
    zipFirst: true,
    zip: "##-###",
    locale: "pl",
    phones: ["+48 5## ### ###", "+48 6## ### ###"],
  },
  FI: {
    calling: "358",
    numberAfter: true,
    zipFirst: true,
    zip: "#####",
    locale: "fi",
    phones: ["+358 40 ### ####", "+358 50 ### ####"],
  },
  AT: {
    calling: "43",
    numberAfter: true,
    zipFirst: true,
    zip: "####",
    locale: "de_AT",
    phones: ["+43 66# ### ####"],
  },
  SI: {
    calling: "386",
    numberAfter: true,
    zipFirst: true,
    zip: "####",
    locale: "sl_SI",
    phones: ["+386 4# ### ###", "+386 5# ### ###"],
  },
  CZ: {
    calling: "420",
    numberAfter: true,
    zipFirst: true,
    zip: "### ##",
    locale: "cs_CZ",
    phones: ["+420 6## ### ###", "+420 7## ### ###"],
  },
  LV: {
    calling: "371",
    numberAfter: true,
    zipFirst: false,
    zip: "LV-####",
    locale: "lv",
    phones: ["+371 2# ### ###"],
  },
  EE: {
    calling: "372",
    numberAfter: true,
    zipFirst: true,
    zip: "#####",
    phones: ["+372 5### ####"],
  },
  LT: {
    calling: "370",
    numberAfter: true,
    zipFirst: false,
    zip: "LT-#####",
    phones: ["+370 6## #####"],
  },
  HR: {
    calling: "385",
    numberAfter: true,
    zipFirst: true,
    zip: "#####",
    locale: "hr",
    phones: ["+385 9# ### ####"],
  },
};

/** One city the generator knows. */
export interface City {
  /** A key of {@link COUNTRIES}. */
  country: string;
  /** US and Canadian area codes for `@` in a phone pattern. */
  area?: string[];
  /** US state or Canadian province, as a person writes it in an address. */
  region?: string;
  /** Real neighbourhoods. A town with none uses its centre. */
  neighbourhoods?: Neighbourhood[];
  /** The middle of a town that has no neighbourhoods, as [lat, lng]. */
  centre?: [number, number];
  /** The first characters every postcode near the town's centre shares. */
  zip?: string;
}

const n = (
  name: string,
  street: string,
  zip: string,
  lat: number,
  lng: number,
): Neighbourhood => ({ name, street, zip, lat, lng });

/**
 * Cities by their name, lowercase and without accents. A contact's
 * `location` ("Boston, MA, USA") is read up to its first comma.
 */
export const CITIES: Record<string, City> = {
  // ── The big cities, with neighbourhoods ────────────────────────────────
  "san francisco": {
    country: "US",
    region: "CA",
    area: ["415", "628"],
    neighbourhoods: [
      n("Mission District", "Valencia St", "94110", 37.7599, -122.4148),
      n("SoMa", "Folsom St", "94103", 37.7785, -122.4056),
      n("Hayes Valley", "Hayes St", "94102", 37.7759, -122.4245),
      n("Noe Valley", "24th St", "94114", 37.7502, -122.4337),
      n("Marina", "Chestnut St", "94123", 37.8037, -122.4368),
      n("Inner Richmond", "Clement St", "94118", 37.78, -122.47),
    ],
  },
  "new york": {
    country: "US",
    region: "NY",
    area: ["212", "646", "917"],
    neighbourhoods: [
      n("Midtown", "W 42nd St", "10036", 40.7549, -73.984),
      n("Financial District", "Broad St", "10004", 40.7075, -74.0113),
      n("Williamsburg", "Bedford Ave", "11211", 40.7163, -73.9587),
      n("Upper West Side", "Amsterdam Ave", "10024", 40.787, -73.9754),
      n("Park Slope", "5th Ave", "11215", 40.671, -73.9777),
      n("Astoria", "Ditmars Blvd", "11105", 40.7644, -73.9235),
    ],
  },
  boston: {
    country: "US",
    region: "MA",
    area: ["617", "857"],
    neighbourhoods: [
      n("Back Bay", "Newbury St", "02116", 42.3503, -71.081),
      n("South End", "Tremont St", "02118", 42.3417, -71.0724),
      n("Beacon Hill", "Charles St", "02114", 42.3588, -71.0707),
      n("Seaport", "Seaport Blvd", "02210", 42.3519, -71.044),
      n("Jamaica Plain", "Centre St", "02130", 42.3099, -71.1142),
    ],
  },
  austin: {
    country: "US",
    region: "TX",
    area: ["512", "737"],
    neighbourhoods: [
      n("Downtown", "Congress Ave", "78701", 30.2672, -97.7431),
      n("East Austin", "E 6th St", "78702", 30.262, -97.717),
      n("South Congress", "S Congress Ave", "78704", 30.248, -97.75),
      n("Hyde Park", "Duval St", "78751", 30.306, -97.726),
      n("Zilker", "Barton Springs Rd", "78704", 30.264, -97.77),
    ],
  },
  chicago: {
    country: "US",
    region: "IL",
    area: ["312", "773"],
    neighbourhoods: [
      n("The Loop", "W Adams St", "60603", 41.8819, -87.6278),
      n("West Loop", "W Randolph St", "60607", 41.8826, -87.653),
      n("Lincoln Park", "N Clark St", "60614", 41.9214, -87.6513),
      n("Wicker Park", "N Milwaukee Ave", "60622", 41.9088, -87.6796),
      n("Hyde Park", "E 57th St", "60637", 41.7943, -87.5907),
    ],
  },
  seattle: {
    country: "US",
    region: "WA",
    area: ["206"],
    neighbourhoods: [
      n("Capitol Hill", "Broadway", "98102", 47.6253, -122.3222),
      n("Belltown", "1st Ave", "98121", 47.6145, -122.3468),
      n("Fremont", "N 34th St", "98103", 47.651, -122.3501),
      n("Ballard", "NW Market St", "98107", 47.6686, -122.3844),
      n("South Lake Union", "Westlake Ave N", "98109", 47.6253, -122.3365),
    ],
  },
  toronto: {
    country: "CA",
    region: "ON",
    area: ["416", "647"],
    neighbourhoods: [
      n("Financial District", "King St W", "M5H", 43.651, -79.3832),
      n("Queen West", "Queen St W", "M6J", 43.6476, -79.402),
      n("The Annex", "Bloor St W", "M5S", 43.6706, -79.407),
      n("Leslieville", "Queen St E", "M4M", 43.6626, -79.3358),
      n("Yorkville", "Cumberland St", "M5R", 43.6708, -79.3936),
    ],
  },
  london: {
    country: "GB",
    neighbourhoods: [
      n("Shoreditch", "Curtain Rd", "EC2A", 51.5246, -0.078),
      n("Soho", "Wardour St", "W1F", 51.5136, -0.1337),
      n("Islington", "Upper St", "N1", 51.5362, -0.1031),
      n("Brixton", "Coldharbour Ln", "SW9", 51.4613, -0.1156),
      n("Kensington", "Kensington High St", "W8", 51.499, -0.1918),
      n("Greenwich", "Greenwich High Rd", "SE10", 51.4826, -0.0077),
    ],
  },
  dublin: {
    country: "IE",
    neighbourhoods: [
      n("City Centre", "Dawson St", "D02", 53.3418, -6.2603),
      n("Smithfield", "Queen St", "D07", 53.3489, -6.278),
      n("Ranelagh", "Ranelagh Rd", "D06", 53.3265, -6.256),
      n(
        "Grand Canal Dock",
        "Sir John Rogerson's Quay",
        "D02",
        53.3456,
        -6.2391,
      ),
      n("Phibsborough", "Phibsborough Rd", "D07", 53.3614, -6.2732),
    ],
  },
  paris: {
    country: "FR",
    neighbourhoods: [
      n("Le Marais", "Rue de Bretagne", "75003", 48.8575, 2.3622),
      n("Montmartre", "Rue des Abbesses", "75018", 48.8867, 2.3431),
      n("Saint-Germain", "Boulevard Saint-Germain", "75006", 48.8539, 2.3334),
      n("Bastille", "Rue de la Roquette", "75011", 48.8532, 2.3692),
      n("Belleville", "Rue de Belleville", "75020", 48.872, 2.377),
    ],
  },
  berlin: {
    country: "DE",
    neighbourhoods: [
      n("Mitte", "Torstraße", "10119", 52.52, 13.405),
      n("Kreuzberg", "Oranienstraße", "10999", 52.4993, 13.403),
      n("Prenzlauer Berg", "Kastanienallee", "10435", 52.5388, 13.4244),
      n("Neukölln", "Sonnenallee", "12045", 52.4811, 13.435),
      n("Charlottenburg", "Kantstraße", "10627", 52.516, 13.304),
    ],
  },
  amsterdam: {
    country: "NL",
    neighbourhoods: [
      n("Jordaan", "Westerstraat", "1015", 52.3745, 4.881),
      n("De Pijp", "Albert Cuypstraat", "1073", 52.3547, 4.8939),
      n("Oost", "Javastraat", "1094", 52.36, 4.924),
      n("Centrum", "Damrak", "1012", 52.3702, 4.8952),
      n("Noord", "Tolhuisweg", "1031", 52.39, 4.912),
    ],
  },
  lisbon: {
    country: "PT",
    neighbourhoods: [
      n("Baixa", "Rua Augusta", "1100", 38.711, -9.139),
      n("Alfama", "Rua de São Miguel", "1100", 38.7119, -9.129),
      n("Bairro Alto", "Rua da Rosa", "1200", 38.7136, -9.146),
      n("Príncipe Real", "Rua Dom Pedro V", "1250", 38.716, -9.15),
      n("Parque das Nações", "Avenida D. João II", "1990", 38.768, -9.095),
    ],
  },
  "mexico city": {
    country: "MX",
    neighbourhoods: [
      n("Roma Norte", "Calle Durango", "06700", 19.419, -99.163),
      n("Condesa", "Avenida Amsterdam", "06100", 19.411, -99.172),
      n("Polanco", "Avenida Presidente Masaryk", "11560", 19.433, -99.196),
      n("Coyoacán", "Calle Francisco Sosa", "04000", 19.35, -99.162),
      n("Centro Histórico", "Calle Madero", "06000", 19.433, -99.133),
    ],
  },
  "sao paulo": {
    country: "BR",
    neighbourhoods: [
      n("Pinheiros", "Rua dos Pinheiros", "05422", -23.567, -46.692),
      n("Vila Madalena", "Rua Harmonia", "05435", -23.553, -46.691),
      n("Jardins", "Alameda Santos", "01418", -23.57, -46.66),
      n("Bela Vista", "Avenida Paulista", "01310", -23.5614, -46.6559),
      n("Moema", "Avenida Ibirapuera", "04029", -23.601, -46.666),
    ],
  },
  nairobi: {
    country: "KE",
    neighbourhoods: [
      n("Westlands", "Waiyaki Way", "00800", -1.268, 36.811),
      n("Kilimani", "Argwings Kodhek Road", "00100", -1.289, 36.788),
      n("Karen", "Karen Road", "00502", -1.319, 36.709),
      n("CBD", "Kenyatta Avenue", "00100", -1.2833, 36.8219),
      n("Lavington", "James Gichuru Road", "00100", -1.28, 36.77),
    ],
  },
  singapore: {
    country: "SG",
    neighbourhoods: [
      n("Tiong Bahru", "Tiong Bahru Road", "160", 1.2854, 103.8324),
      n("Marina Bay", "Marina Boulevard", "018", 1.2834, 103.8607),
      n("Orchard", "Orchard Road", "238", 1.3048, 103.8318),
      n("Holland Village", "Lorong Mambong", "277", 1.3112, 103.7956),
      n("Katong", "East Coast Road", "428", 1.305, 103.905),
    ],
  },
  seoul: {
    country: "KR",
    neighbourhoods: [
      n("Gangnam", "Teheran-ro", "06134", 37.4979, 127.0276),
      n("Hongdae", "Wausan-ro", "04039", 37.5563, 126.9236),
      n("Itaewon", "Itaewon-ro", "04350", 37.5345, 126.9946),
      n("Seongsu", "Achasan-ro", "04796", 37.5446, 127.0557),
      n("Jongno", "Jong-ro", "03154", 37.573, 126.9794),
    ],
  },
  tokyo: {
    country: "JP",
    neighbourhoods: [
      n("Shibuya", "Dogenzaka", "150-0043", 35.658, 139.7016),
      n("Shinjuku", "Yasukuni-dori", "160-0022", 35.6938, 139.7034),
      n("Roppongi", "Roppongi-dori", "106-0032", 35.6628, 139.731),
      n("Marunouchi", "Marunouchi Naka-dori", "100-0005", 35.6812, 139.7671),
      n("Daikanyama", "Kyu-Yamate-dori", "150-0034", 35.6487, 139.703),
      n("Shimokitazawa", "Kita-dori", "155-0031", 35.6613, 139.668),
    ],
  },
  "tel aviv": {
    country: "IL",
    neighbourhoods: [
      n("Rothschild Boulevard", "Rothschild Boulevard", "6688", 32.064, 34.775),
      n("Florentin", "Florentin Street", "6610", 32.056, 34.77),
      n("Neve Tzedek", "Shabazi Street", "6515", 32.06, 34.765),
      n("Sarona", "Kaplan Street", "6473", 32.072, 34.787),
      n("Jaffa", "Yefet Street", "6811", 32.05, 34.752),
    ],
  },
  stockholm: {
    country: "SE",
    neighbourhoods: [
      n("Södermalm", "Götgatan", "118", 59.315, 18.07),
      n("Östermalm", "Karlavägen", "114", 59.338, 18.085),
      n("Vasastan", "Odengatan", "113", 59.344, 18.045),
      n("Norrmalm", "Drottninggatan", "111", 59.333, 18.063),
      n("Kungsholmen", "Hantverkargatan", "112", 59.333, 18.033),
    ],
  },
  sydney: {
    country: "AU",
    region: "NSW",
    neighbourhoods: [
      n("Surry Hills", "Crown St", "2010", -33.885, 151.211),
      n("Newtown", "King St", "2042", -33.898, 151.179),
      n("Bondi", "Campbell Parade", "2026", -33.8915, 151.2767),
      n("CBD", "George St", "2000", -33.8688, 151.2093),
      n("Paddington", "Oxford St", "2021", -33.884, 151.228),
      n("Glebe", "Glebe Point Rd", "2037", -33.88, 151.185),
    ],
  },
  zurich: {
    country: "CH",
    neighbourhoods: [
      n("Altstadt", "Niederdorfstrasse", "8001", 47.37, 8.544),
      n("Kreis 4", "Langstrasse", "8004", 47.378, 8.524),
      n("Zürich West", "Hardstrasse", "8005", 47.387, 8.517),
      n("Enge", "Bleicherweg", "8002", 47.364, 8.53),
      n("Oerlikon", "Schaffhauserstrasse", "8050", 47.411, 8.544),
    ],
  },
  bangalore: {
    country: "IN",
    neighbourhoods: [
      n("Indiranagar", "100 Feet Road", "560038", 12.9719, 77.6412),
      n("Koramangala", "80 Feet Road", "560034", 12.9352, 77.6245),
      n("HSR Layout", "27th Main Road", "560102", 12.9116, 77.6474),
      n("Whitefield", "ITPL Main Road", "560066", 12.9698, 77.75),
      n("Jayanagar", "11th Main Road", "560041", 12.9299, 77.5823),
      n("MG Road", "MG Road", "560001", 12.9756, 77.6066),
    ],
  },

  // ── Towns: a country, a postcode prefix and a centre. Every pin stands
  // within 1.8 km of the centre. Every street postcode in that circle starts
  // with the prefix, checked in September 2026 against postal directories.
  // In the UK and Ireland the prefix is the outward code or the Eircode
  // routing key at the centre itself, and the edge of the circle can be in
  // the next district.
  aarhus: { country: "DK", zip: "8", centre: [56.1629, 10.2039] },
  abuja: { country: "NG", zip: "900", centre: [9.0765, 7.3986] },
  antwerp: { country: "BE", zip: "2", centre: [51.2194, 4.4025] },
  athens: { country: "GR", zip: "1", centre: [37.9838, 23.7275] },
  barcelona: { country: "ES", zip: "080", centre: [41.3874, 2.1686] },
  basel: { country: "CH", zip: "40", centre: [47.5596, 7.5886] },
  belfast: { country: "GB", zip: "BT1", centre: [54.5973, -5.9301] },
  bergen: { country: "NO", zip: "5", centre: [60.3913, 5.3221] },
  bilbao: { country: "ES", zip: "480", centre: [43.263, -2.935] },
  bologna: { country: "IT", zip: "401", centre: [44.4949, 11.3426] },
  bordeaux: { country: "FR", zip: "33", centre: [44.8378, -0.5792] },
  bratislava: { country: "SK", zip: "8", centre: [48.1486, 17.1077] },
  bristol: { country: "GB", zip: "BS1", centre: [51.4545, -2.5879] },
  budapest: { country: "HU", zip: "1", centre: [47.4979, 19.0402] },
  cardiff: { country: "GB", zip: "CF10", centre: [51.4816, -3.1791] },
  cork: { country: "IE", zip: "T12", centre: [51.8985, -8.4756] },
  edinburgh: { country: "GB", zip: "EH1", centre: [55.9533, -3.1883] },
  galway: { country: "IE", zip: "H91", centre: [53.2707, -9.0568] },
  gdansk: { country: "PL", zip: "80", centre: [54.352, 18.6466] },
  genoa: { country: "IT", zip: "161", centre: [44.4056, 8.9463] },
  ghent: { country: "BE", zip: "90", centre: [51.0543, 3.7174] },
  glasgow: { country: "GB", zip: "G1", centre: [55.8642, -4.2518] },
  gothenburg: { country: "SE", zip: "41", centre: [57.7089, 11.9746] },
  helsinki: { country: "FI", zip: "00", centre: [60.1699, 24.9384] },
  innsbruck: { country: "AT", zip: "60", centre: [47.2692, 11.4041] },
  krakow: { country: "PL", zip: "3", centre: [50.0647, 19.945] },
  lagos: { country: "NG", zip: "10", centre: [6.5244, 3.3792] },
  leeds: { country: "GB", zip: "LS1", centre: [53.8008, -1.5491] },
  limerick: { country: "IE", zip: "V94", centre: [52.6638, -8.6267] },
  ljubljana: { country: "SI", zip: "1", centre: [46.0569, 14.5058] },
  lyon: { country: "FR", zip: "6900", centre: [45.764, 4.8357] },
  malmo: { country: "SE", zip: "21", centre: [55.605, 13.0038] },
  manchester: { country: "GB", zip: "M2", centre: [53.4808, -2.2426] },
  milan: { country: "IT", zip: "201", centre: [45.4642, 9.19] },
  munich: { country: "DE", zip: "8", centre: [48.1351, 11.582] },
  naples: { country: "IT", zip: "801", centre: [40.8518, 14.2681] },
  oslo: { country: "NO", zip: "0", centre: [59.9139, 10.7522] },
  porto: { country: "PT", zip: "4", centre: [41.1579, -8.6291] },
  prague: { country: "CZ", zip: "1", centre: [50.0755, 14.4378] },
  riga: { country: "LV", zip: "LV-10", centre: [56.9496, 24.1052] },
  rotterdam: { country: "NL", zip: "30", centre: [51.9244, 4.4777] },
  sapporo: { country: "JP", zip: "0", centre: [43.0618, 141.3545] },
  seville: { country: "ES", zip: "410", centre: [37.3891, -5.9845] },
  sheffield: { country: "GB", zip: "S1", centre: [53.3811, -1.4701] },
  sligo: { country: "IE", zip: "F91", centre: [54.2766, -8.4761] },
  stuttgart: { country: "DE", zip: "70", centre: [48.7758, 9.1829] },
  tallinn: { country: "EE", zip: "1", centre: [59.437, 24.7536] },
  turin: { country: "IT", zip: "101", centre: [45.0703, 7.6869] },
  umea: { country: "SE", zip: "90", centre: [63.8258, 20.263] },
  valencia: { country: "ES", zip: "460", centre: [39.4699, -0.3763] },
  vienna: { country: "AT", zip: "1", centre: [48.2082, 16.3738] },
  vilnius: { country: "LT", zip: "LT-", centre: [54.6872, 25.2797] },
  warsaw: { country: "PL", zip: "0", centre: [52.2297, 21.0122] },
  zagreb: { country: "HR", zip: "10", centre: [45.815, 15.9819] },
};

/** "Sao Paulo, Brazil" and "São Paulo" both read as "sao paulo". */
export function cityKey(location: string | null | undefined): string | null {
  if (!location) return null;
  const key = location
    .split(",")[0]
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase();
  return key || null;
}
