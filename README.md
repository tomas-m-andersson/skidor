# SKIDOR

Mobilanpassad samlingssida för längdskidor, skidskytte, Tour de Ski, VM, SM, Ski Classics och Vasaloppet – med TV-tablå, kalender och påminnelser. Allt på svenska.

## Filer

| Fil | Vad den gör |
|---|---|
| `index.html` | Själva sidan |
| `styles.css` | Utseende (ljust/mörkt tema) |
| `app.js` | All logik: tablå, kalender, filter, påminnelser, kalenderfiler |
| `data/sasonger.json` | Lista över säsonger + namn och färger för serierna |
| `data/sasong-2026-27.json` | **All tävlings- och TV-data för 2026/27** |
| `config.json` | Adressen till push-tjänsten |
| `push/` | Push-tjänsten (Cloudflare Worker) och guide |
| `sw.js`, `manifest.webmanifest`, `icon*` | Gör att sidan kan installeras som app på mobilen |

## Uppdatera en sändning (t.ex. när Viaplay släpper tider)

> ⚠️ **Varning:** Datafilen styr hela sidan. Ett enda saknat kommatecken eller citattecken gör att sidan visar "Kunde inte ladda tablån". Ändra en rad i taget och kontrollera alltid efteråt.

1. Gå till repot på github.com och klicka på mappen **data**.
2. Klicka på **sasong-2026-27.json**.
3. Klicka på **pennan** (✏️, "Edit this file") uppe till höger ovanför filinnehållet.
4. Tryck **Ctrl+F** (Mac: Cmd+F) och sök på datum och ort, t.ex. `2026-11-27` och `Ruka`.
5. Varje sändning är **en rad**. Exempel på en rad utan tid:
   ```
   {"datum": "2026-11-27", "sport": "langd", "serie": "vc", "ort": "Ruka", ..., "kanal": ["Viaplay"], "notering": "Viaplays tider ej publicerade.", "id": "..."},
   ```
   Lägg till tid genom att skriva in `"start": "10:15", "slut": "12:00",` direkt efter datumet:
   ```
   {"datum": "2026-11-27", "start": "10:15", "slut": "12:00", "sport": "langd", ...
   ```
   - Tider skrivs med **kolon** (`10:15`) och i **svensk tid**.
   - Ta gärna bort `"notering": "..."` (inklusive kommatecknet före) när tiden är klar.
   - **Ändra aldrig `"id"`** – då försvinner sparade påminnelser för den sändningen.
6. Scrolla ner, skriv kort vad du ändrat i rutan **Commit changes** och klicka på den gröna knappen **Commit changes**.
7. Vänta ca 1 minut, öppna sidan och kontrollera att sändningen ser rätt ut.

### Fälten

| Fält | Värden |
|---|---|
| `sport` | `langd` eller `skidskytte` |
| `serie` | `vc` (Världscupen), `vm`, `tds` (Tour de Ski), `sm`, `sc` (Ski Classics), `vasa` (Vasaloppet), `premiar` (Sverigepremiär) |
| `klass` | `D` (damer), `H` (herrar), `DH` (båda), `Mix` (mixed) |
| `kanal` | Lista, t.ex. `["SVT1", "SVT Play"]`. Tom lista `[]` = kanal ej klar |
| `land` | Landskod för flaggan, t.ex. `SWE`, `NOR`, `FIN` (se `sasonger.json`) |

## Lägga till en ny säsong (t.ex. 2027/28)

1. Kopiera `data/sasong-2026-27.json` till en ny fil, t.ex. `data/sasong-2027-28.json`, och byt ut händelserna.
2. Lägg till säsongen i `data/sasonger.json` under `"sasonger"`:
   ```json
   { "id": "2027-28", "namn": "2027/28", "fil": "data/sasong-2027-28.json" }
   ```
   (glöm inte kommatecknet mellan raderna) och ändra `"standard"` till `"2027-28"`.
3. Säsongsväljaren uppe till höger dyker då upp med båda säsongerna.

## Påminnelser

- **Push-notiser** (Inställningar → Push-notiser) kommer även när appen är stängd. Kräver push-tjänsten i mappen `push/` – se **[push/GUIDE.md](push/GUIDE.md)**. Adressen till tjänsten står i `config.json`.

- **Klockan 🔔** sparar sändningen under fliken *Påminnelser* (sparas i den här webbläsaren).
- **Lägg i kalendern** laddar ner en kalenderfil (.ics) med larm – öppna den så läggs sändningen in i mobilens kalender. Larmet fungerar även när sidan är stängd.

Alla tider är svensk tid. Källor finns under Inställningar på sidan.
