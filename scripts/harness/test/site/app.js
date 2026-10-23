// The test site's front end: lists from its server, a list that depends on another, a search as you type, a
// section a choice opens, and every change saved with the session's token.
let csrf = "";
const $ = (id) => document.getElementById(id);
const getJson = (url) => fetch(url).then((r) => r.json());

async function save(field, value) {
  await fetch("/api/save", {
    method: "POST",
    headers: { "content-type": "application/json", "x-csrf": csrf },
    body: JSON.stringify({ field, value }),
  });
}

async function start() {
  csrf = (await getJson("/api/session")).csrf;
  const { countries } = await getJson("/api/countries");
  for (const c of countries) $("country").append(new Option(c.name, c.code));
}

$("country").addEventListener("change", async (e) => {
  const code = e.target.value;
  $("region").length = 1;
  $("region-row").hidden = true;
  if (code) {
    const { regions } = await getJson(`/api/regions?country=${encodeURIComponent(code)}`);
    for (const r of regions) $("region").append(new Option(r, r));
    $("region-row").hidden = regions.length === 0;
  }
  save("country", code);
});

$("school").addEventListener("input", async (e) => {
  const q = e.target.value;
  const { results } = await getJson(`/api/schools?q=${encodeURIComponent(q)}`);
  $("schools").replaceChildren(...results.map((s) => new Option(s.name)));
});

for (const r of document.querySelectorAll("input[name=sponsor]")) {
  r.addEventListener("change", () => {
    $("sponsor-row").hidden = r.value !== "yes";
    save("sponsor", r.value);
  });
}

for (const id of ["first", "last", "email", "region", "school", "sponsor-detail"]) {
  $(id).addEventListener("change", (e) => save(id, e.target.value));
}

start();
