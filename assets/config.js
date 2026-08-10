/* ============================================================
   OPAC Futsal — configuration
   This is the ONLY file you should need to edit for setup.
   ============================================================ */
window.OPAC = {

  /* Realtime Database URL (no trailing slash) */
  dbUrl: 'https://opac-futsal-world-champi-1017b-default-rtdb.asia-southeast1.firebasedatabase.app',

  /* Top-level key the competition is stored under */
  path: 'futsal',

  /* ----------------------------------------------------------
     ADMIN SIGN-IN  (see README.md → "Locking down the database")
     Paste your Firebase Web API key here to turn on the login
     gate. It is safe for this key to be public — it only lets
     someone *attempt* a sign-in; the database rules do the
     actual protecting.
     Leave it as '' and the admin page still works, but it will
     show a warning that anyone can edit the competition.
     ---------------------------------------------------------- */
  apiKey: '',

  /* Public site branding */
  siteName: 'OPAC Futsal',
  logo: 'assets/logo.jpg',

  /* How often to fall back to polling (ms) if live streaming
     is blocked by the school network */
  pollInterval: 20000
};
