# Sätt upp push-notiser för SKIDOR (görs en gång, ca 20–30 min)

Push-notiserna skickas av en liten tjänst som körs **gratis** hos Cloudflare. Tjänsten kollar varje minut om någon påminnelse ska skickas och skickar då en notis till mobilen eller datorn – även när appen är stängd.

Cloudflares sidor är på **engelska**, så knapparnas namn står på engelska nedan.

Du behöver bara en sak från den här mappen: filen **`worker.js`**.

---

## Steg 1 – Skapa ett gratis konto hos Cloudflare

1. Gå till **https://dash.cloudflare.com/sign-up**
2. Fyll i din e-post och ett lösenord och klicka på **Sign up**.
3. Öppna mejlet från Cloudflare och klicka på länken för att bekräfta adressen.
4. Om Cloudflare frågar vad du vill göra (t.ex. "add a domain") kan du hoppa över det – vi behöver ingen egen domän.

**Du ska nu se:** Cloudflares översiktssida med en meny till vänster.

---

## Steg 2 – Skapa tjänsten (en "Worker")

1. I menyn till vänster: klicka på **Compute (Workers)** → **Workers & Pages**.
   *(Heter det något annat? Leta efter "Workers & Pages".)*
2. Klicka på den blå knappen **Create** (uppe till höger).
3. Välj **Start with Hello World!** (eller "Create Worker").
4. I fältet för namn: skriv **`skidor-push`**
5. Klicka på **Deploy**.

**Du ska nu se:** "Success! Your project is deployed" och en adress som slutar på **`.workers.dev`**, t.ex. `https://skidor-push.tomas.workers.dev`. **Spara den adressen** – du behöver den i steg 7.

---

## Steg 3 – Skapa lagringen (KV) där påminnelserna sparas

1. I menyn till vänster: klicka på **Storage & Databases** → **KV**.
2. Klicka på **Create** (eller "Create a namespace").
3. Namn: skriv **`skidor-push`** och klicka på **Create** / **Add**.

**Du ska nu se:** `skidor-push` i listan över KV-namespaces.

---

## Steg 4 – Koppla lagringen till tjänsten

1. Gå tillbaka till **Workers & Pages** och klicka på **skidor-push**.
2. Klicka på fliken **Bindings** (finns ibland under **Settings** → **Bindings**).
3. Klicka på **Add binding** → välj **KV namespace** → **Add Binding**.
4. **Variable name:** skriv exakt **`SKIDOR_KV`** (versaler, med understreck). Det måste stavas exakt så, annars hittar tjänsten inte lagringen.
5. **KV namespace:** välj **skidor-push** i listan.
6. Klicka på **Add Binding** / **Save**.

---

## Steg 5 – Klistra in koden

1. Öppna filen `push/worker.js` i GitHub-repot **skidor** i en ny flik.
2. Klicka på knappen **Copy raw file** (ikonen med två fyrkanter, ovanför koden till höger). Nu ligger hela koden i urklipp.
3. Tillbaka i Cloudflare, på sidan för **skidor-push**: klicka på **Edit code** (knappen med `</>` uppe till höger).
4. En kodredigerare öppnas. Klicka i koden, tryck **Ctrl+A** (markera allt) och sedan **Delete**.
5. Tryck **Ctrl+V** för att klistra in den nya koden.
6. Klicka på den blå knappen **Deploy** uppe till höger. Bekräfta om den frågar igen.

**Du ska nu se:** "Version deployed" eller liknande.

---

## Steg 6 – Låt tjänsten köra varje minut

1. Gå tillbaka till sidan för **skidor-push** (pilen uppe till vänster i kodredigeraren).
2. Klicka på **Settings**.
3. Leta upp **Trigger Events** (eller "Triggers") och klicka på **Add** → **Cron Triggers**.
4. Välj **Minute** och skriv **1** (alltså "varje minut"), eller skriv uttrycket **`* * * * *`** (fem stjärnor med mellanslag).
5. Klicka på **Add** / **Save**.

---

## Steg 7 – Kontrollera att tjänsten fungerar

1. Öppna adressen från steg 2 i webbläsaren, t.ex. `https://skidor-push.tomas.workers.dev`
2. **Du ska se en rad som börjar med:** `{"ok":true,"tjanst":"SKIDOR push"...`
   - Står det i stället något om **SKIDOR_KV saknas** → gör om steg 4 och kontrollera stavningen.

---

## Steg 8 – Koppla appen till tjänsten

Skicka adressen från steg 2 till Claude, så lägger Claude in den i filen `config.json` i repot.

*(Vill du göra det själv: öppna `config.json` i repot, klicka på pennan ✏️ och skriv in adressen mellan citattecknen efter `"pushServer":`, t.ex. `"pushServer": "https://skidor-push.tomas.workers.dev"`. Var noga med citattecknen – ett fel gör att push inte startar.)*

---

## Steg 9 – Slå på push i appen

1. Vänta ca 10 minuter efter att `config.json` uppdaterats och ladda om SKIDOR.
2. Tryck på inställningsknappen uppe till höger → **Push-notiser** → slå på.
3. Webbläsaren frågar om sidan får visa aviseringar → **Tillåt**.
4. Tryck på **🔔 Skicka testnotis**. En notis ska dyka upp inom några sekunder.

### Kommer ingen testnotis i Brave?

- **Windows:** skriv `brave://settings/privacy` i adressfältet → slå på **Använd Googles tjänster för pushmeddelanden** → starta om Brave → stäng av och slå på Push-notiser i appen igen.
- **Android:** telefonens **Inställningar** → **Appar** → **Brave** → **Aviseringar** → på. Kontrollera också att **Batterisparläge** inte stoppar Brave (Inställningar → Appar → Brave → Batteri → **Obegränsad**).

---

## Bra att veta

- **Kostnad:** gratisnivån räcker gott (tjänsten använder ungefär 1 500 läsningar per dygn av 100 000 gratis).
- **Säkerhet:** tjänsten skapar sina egna krypteringsnycklar första gången och sparar dem i KV-lagringen. Du behöver aldrig hantera några hemliga nycklar.
- **Uppdatera koden senare:** upprepa steg 5 med den nya `worker.js`.
