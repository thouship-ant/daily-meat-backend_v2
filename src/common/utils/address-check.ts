// Port of daily-meat-backend/src/utils/addressCheck.js and daily-meat-application/src/utils/addressUtils.ts (keep in sync)
// Address checks and clean-up for the Add / Edit Address screen.
//  - The "City" must be a real Tamil Nadu city or town (not a locality like "Koranattu Karuppur II").
//  - The "House No. / Street" must be a full address line (door no. & street, building, ward / zone ...).

// Tamil Nadu district headquarters, municipal corporations and larger towns
const TN_CITIES = [
  'Chennai', 'Coimbatore', 'Madurai', 'Tiruchirappalli', 'Salem', 'Tirunelveli', 'Tiruppur', 'Erode', 'Vellore',
  'Thoothukudi', 'Dindigul', 'Thanjavur', 'Ranipet', 'Sivakasi', 'Karur', 'Udhagamandalam', 'Hosur', 'Nagercoil',
  'Kanchipuram', 'Kumbakonam', 'Rajapalayam', 'Pudukkottai', 'Ambur', 'Karaikudi', 'Neyveli', 'Nagapattinam',
  'Viluppuram', 'Tiruvannamalai', 'Cuddalore', 'Tambaram', 'Avadi', 'Tiruvallur', 'Krishnagiri', 'Dharmapuri',
  'Namakkal', 'Perambalur', 'Ariyalur', 'Ramanathapuram', 'Virudhunagar', 'Sivaganga', 'Theni', 'Tenkasi',
  'Tirupathur', 'Kallakurichi', 'Chengalpattu', 'Mayiladuthurai', 'Tiruvarur', 'Thiruvarur', 'Kanyakumari',
  'Pollachi', 'Mettupalayam', 'Gudalur', 'Coonoor', 'Kotagiri', 'Valparai', 'Udumalaipettai', 'Palani', 'Kodaikanal',
  'Bodinayakanur', 'Cumbum', 'Periyakulam', 'Usilampatti', 'Melur', 'Thirumangalam', 'Paramakudi',
  'Rameswaram', 'Devakottai', 'Manamadurai', 'Aruppukkottai', 'Srivilliputhur', 'Sattur', 'Kovilpatti', 'Tiruchendur',
  'Srivaikuntam', 'Sankarankovil', 'Ambasamudram', 'Cheranmahadevi', 'Palayamkottai', 'Kuzhithurai', 'Marthandam',
  'Thuckalay', 'Padmanabhapuram', 'Colachel', 'Mannargudi', 'Papanasam', 'Pattukkottai', 'Orathanadu', 'Peravurani',
  'Budalur', 'Thiruvaiyaru', 'Tiruvidaimarudur', 'Swamimalai', 'Sirkazhi', 'Vedaranyam', 'Thirukkuvalai', 'Koothanallur',
  'Lalgudi', 'Srirangam', 'Musiri', 'Thuraiyur', 'Manapparai', 'Thottiyam', 'Kulithalai', 'Aravakurichi', 'Krishnarayapuram',
  'Gobichettipalayam', 'Bhavani', 'Perundurai', 'Sathyamangalam', 'Anthiyur', 'Kangeyam', 'Dharapuram', 'Avinashi',
  'Palladam', 'Mettur', 'Attur', 'Omalur', 'Edappadi', 'Sankagiri', 'Tiruchengode', 'Rasipuram', 'Paramathi Velur',
  'Harur', 'Palacode', 'Pennagaram', 'Denkanikottai', 'Uthangarai', 'Vaniyambadi', 'Gudiyatham', 'Arakkonam', 'Arcot',
  'Walajapet', 'Sholinghur', 'Tirupattur', 'Jolarpet', 'Chidambaram', 'Panruti', 'Virudhachalam', 'Vadalur', 'Tindivanam',
  'Gingee', 'Ulundurpettai', 'Sankarapuram', 'Chengam', 'Polur', 'Arani', 'Vandavasi', 'Cheyyar', 'Maduranthakam',
  'Mahabalipuram', 'Sriperumbudur', 'Poonamallee', 'Ponneri', 'Gummidipoondi', 'Tiruttani', 'Tirumangalam', 'Thiruchirappalli',
];

// Common other spellings / names people use
const ALIASES: Record<string, string> = {
  trichy: 'Tiruchirappalli',
  tiruchchirappalli: 'Tiruchirappalli',
  thiruchirappalli: 'Tiruchirappalli',
  trichirappalli: 'Tiruchirappalli',
  tanjore: 'Thanjavur',
  tanjavur: 'Thanjavur',
  madras: 'Chennai',
  kovai: 'Coimbatore',
  tuticorin: 'Thoothukudi',
  kumbakkonam: 'Kumbakonam',
  kumbakonam: 'Kumbakonam',
  ooty: 'Udhagamandalam',
  ootacamund: 'Udhagamandalam',
  tirupur: 'Tiruppur',
  tirunelveli: 'Tirunelveli',
  nellai: 'Tirunelveli',
  kanchipuram: 'Kanchipuram',
  conjeevaram: 'Kanchipuram',
  villupuram: 'Viluppuram',
  thiruvannamalai: 'Tiruvannamalai',
  pudukottai: 'Pudukkottai',
  karaikkudi: 'Karaikudi',
  nagarcoil: 'Nagercoil',
  cuddalore: 'Cuddalore',
  mayavaram: 'Mayiladuthurai',
  mayiladuthurai: 'Mayiladuthurai',
};

const norm = (s: string) => s.toLowerCase().replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim();

const CITY_BY_NORM = new Map<string, string>();
TN_CITIES.forEach((c) => CITY_BY_NORM.set(norm(c), c));
Object.entries(ALIASES).forEach(([k, v]) => CITY_BY_NORM.set(norm(k), v));
const CITY_KEYS = Array.from(CITY_BY_NORM.keys()).sort((a, b) => b.length - a.length); // longest first

/** Returns the proper city name if `text` is (or clearly names) a Tamil Nadu city, e.g. "Kumbakonam Taluk" -> "Kumbakonam". */
export function matchCity(text: string | null | undefined): string | null {
  const n = norm(text || '');
  if (!n) return null;
  const exact = CITY_BY_NORM.get(n);
  if (exact) return exact;
  // a district / taluk label such as "Thanjavur District" or "Kumbakonam Taluk": a whole-word match of a city name
  const stripped = n.replace(/\b(district|taluk|taluka|municipality|corporation|city|town|tk|dt)\b/g, '').replace(/\s+/g, ' ').trim();
  const exact2 = CITY_BY_NORM.get(stripped);
  if (exact2) return exact2;
  return null;
}

// Google "plus codes" such as X9MV+PVM are not an address a delivery person can use
const PLUS_CODE = /^[23456789CFGHJMPQRVWX]{4,8}\+[23456789CFGHJMPQRVWX]{2,}$/i;
const isPlusCode = (s: string) => PLUS_CODE.test(s.trim());

/**
 * The street line must be a full address a delivery person can find. It needs
 *   - a door / house number (12, 12A, 4/5, "No 12"; "1st", "11th" are floor / cross numbers, not door numbers), and
 *   - the street plus the building / floor and the area, i.e. at least 3 different words besides the door number.
 * "Raja Street, Raja Street" fails (no door number, and the same words twice); "12, Raja Street" fails (no area);
 * "No 12, 1st Floor, 11th Cross Railvihar, LIC Colony, KK Nagar" passes. Commas are not required.
 */
const DOOR_NUMBER = /(^|[\s,.:/#()-])(?:[a-zA-Z]{1,2}[-]?)?\d+[a-zA-Z]?(?:[/-]\d+[a-zA-Z]?)?(?=$|[\s,.:/#()-])/;
const DOOR_WORDS = new Set(['no', 'door', 'h', 'flat', 'house', 'plot']);

export function validateStreet(street: string): string | null {
  const s = street.trim();
  if (!s) return 'Please enter your door number and street.';
  if (isPlusCode(s) || !/[a-zA-Z]/.test(s)) {
    return 'Please enter your full address, for example: 12, 1st Floor, Sample Street, Demo Nagar or Locality or Postal Area.';
  }
  if (!DOOR_NUMBER.test(s)) {
    return 'Please add your door / house number and floor. Example: 12, 1st Floor, Sample Street, Demo Nagar or Locality or Postal Area.';
  }
  const words = new Set(
    (s.toLowerCase().match(/[a-z]{2,}/g) || []).filter((w) => !DOOR_WORDS.has(w))
  );
  if (words.size < 3 || s.length < 15) {
    return 'Please add your street, building / floor and area (locality) as well. Example: 12, 1st Floor, Sample Street, Demo Nagar or Locality or Postal Area.';
  }
  return null;
}

/** The city must be a Tamil Nadu city / town. */
export function validateCity(city: string): string | null {
  if (!city.trim()) return 'Please enter your city.';
  if (!matchCity(city)) {
    return `"${city.trim()}" is not a recognised city. Enter your city or town (for example Tiruchirappalli, Thanjavur or Kumbakonam) and put your locality or village name in the street field.`;
  }
  return null;
}

