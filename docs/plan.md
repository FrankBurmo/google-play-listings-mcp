# plan.md – Bygg `play-listings-mcp`

Dette dokumentet er instruksjoner til en AI-kodeagent som skal bygge en MCP-server (Model Context Protocol) i dette repoet. Les hele dokumentet før du begynner å skrive kode. Følg fasene i rekkefølge, og stopp og spør hvis noe er uklart eller i konflikt med sikkerhetsreglene under.

## 1. Mål

Bygg en **lokal MCP-server (stdio)** som lar GitHub Copilot Agent mode (og andre MCP-klienter) jobbe med butikkoppføringer i Google Play for utviklerens egne Android-apper:

- Hente eksisterende oppføringstekster (tittel, kort beskrivelse, full beskrivelse, videolenke) per språk.
- Validere og **foreslå** forbedrede tekster som lokale utkast med diff.
- Kun etter eksplisitt godkjenning: publisere et godkjent utkast til Google Play via Android Publisher API.

Arkitektur:

```
MCP-klient (Copilot agent mode) → play-listings-mcp (lokal, stdio) → Google Play Developer API (androidpublisher v3)
```

Klienten ser aldri service account-nøkkelen. Den ser bare verktøyene serveren eksponerer.

## 2. Ikke-mål (ikke bygg dette)

- Ingen sletting av noe (oppføringer, bilder, edits). Eneste unntak: serveren sletter kun edits den selv har opprettet (med edit-id fra egen `edits.insert`) som opprydding. Opprydding er «best effort»: feil ved `edits.delete` logges, men maskerer aldri den opprinnelige feilen.
- Ingen endring av spor, releaser, APK/AAB, priser, in-app-produkter eller app-innhold.
- Ingen håndtering av anmeldelser, statistikk eller konverteringsdata.
- Ingen HTTP-/SSE-transport. Kun stdio.
- Ingen generering av tekst i serveren selv. Forbedringen gjør klient-LLM-en. Serveren validerer, lagrer utkast og publiserer.

Hvert ekstra verktøy øker angrepsflaten hvis agenten påvirkes av innhold den leser. Hold verktøysettet lite.

## 3. Teknologi

- **Språk:** TypeScript (strict mode), Node.js 24+ (LTS), ESM.
- **MCP:** `@modelcontextprotocol/sdk`
- **Google:** `googleapis` (`androidpublisher` v3) og `google-auth-library`
- **Validering:** `zod`
- **Test:** `vitest`
- **Lint/format:** OxLint + OxFmt
- **Pakkehåndtering:** npm
- **Build:** `tsc` til `dist/`. Binærnavn: `play-listings-mcp`.

Hvis du mener en annen stack er klart bedre, forklar hvorfor og vent på svar før du bytter.

## 4. Konfigurasjon (miljøvariabler)

| Variabel                | Påkrevd | Beskrivelse                                                                                                                    |
| ----------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `PLAY_KEY_FILE`         | ja      | Sti til service account JSON-nøkkel. Aldri i repoet.                                                                           |
| `PLAY_ALLOWED_PACKAGES` | ja      | Kommaseparert allowlist av package names, f.eks. `no.example.app1,no.example.app2`. Alle verktøy avviser pakker utenfor lista. |
| `PLAY_DRAFT_DIR`        | nei     | Mappe for utkast. Default `./drafts` (skal ligge i `.gitignore`).                                                              |
| `PLAY_ENABLE_APPLY`     | nei     | Default `false`. Verktøyet `apply_draft` registreres **kun** når denne er `true`.                                              |
| `LOG_LEVEL`             | nei     | `error` \| `warn` \| `info` \| `debug`. Default `info`.                                                                        |

Valider alle variabler med zod ved oppstart. Feil ved oppstart skal gi en tydelig melding på stderr og exit-kode 1.

Merk: Play Developer API har ingen endepunkt for å liste alle apper på en konto. Derfor er `PLAY_ALLOWED_PACKAGES` både sikkerhetsmekanisme og kilden til hvilke apper som finnes.

## 5. Verktøy som skal eksponeres

Alle verktøy bruker zod-skjema for input, returnerer strukturert tekst (JSON som tekst er OK), og skal ha korrekte MCP tool annotations (`readOnlyHint`, `destructiveHint`, `idempotentHint`).

### 5.1 `list_apps` (read-only)

Returnerer pakkene i `PLAY_ALLOWED_PACKAGES`.

### 5.2 `list_listings` (read-only)

Input: `packageName`. Åpner en edit, kaller `edits.listings.list`, **sletter edit-en** (`edits.delete`), returnerer alle lokaliserte oppføringer.

### 5.3 `get_listing` (read-only)

Input: `packageName`, `language` (BCP-47, f.eks. `nb-NO`, `en-US`). Åpner edit, `edits.listings.get`, sletter edit, returnerer oppføringen. Inkluder tegnlengder per felt i svaret.

### 5.4 `propose_listing_update` (skriver kun lokalt)

Input: `packageName`, `language`, og minst ett av `title`, `shortDescription`, `fullDescription` (valgfritt også `video`).

Oppførsel:

1. Hent gjeldende live-oppføring.
2. Valider forslaget mot grensene: **tittel ≤ 30**, **kort beskrivelse ≤ 80**, **full beskrivelse ≤ 4000** tegn. Tell **Unicode-kodepunkter** (`[...str].length`), ikke UTF-16-enheter, bytes eller grafem-klynger. Dette antas å samsvare med Google Play, og skal verifiseres manuelt og dokumenteres i README under «Kjente begrensninger». Avvis med tydelig feilmelding som sier hvilket felt og hvor mange tegn over grensen.
   - Semantikk: et utelatt felt betyr «uendret». Tom streng avvises for `title`, `shortDescription` og `fullDescription`. `video` kan settes til tom streng for å fjerne videolenken (kun det feltet).
3. Skriv et utkast til `PLAY_DRAFT_DIR/<packageName>/<language>/<createdAt>-<draftId>.json` med: `draftId` (UUID), `base` (live-tekster for alle fire felt), `base_hash`, `proposed`, `createdAt`. Filnavnet inneholder `draftId` for å unngå kollisjoner.
   - `base_hash` = SHA-256 av kanonisk JSON av `{title, shortDescription, fullDescription, video}` (faste nøkler i alfabetisk rekkefølge, manglende verdi som tom streng, alle tekster NFC-normalisert, UTF-8). Samme funksjon brukes ved forslag og ved `apply_draft`.
4. Returner `draftId` og en lesbar **diff** per felt (før/etter og tegnlengder).

Dette verktøyet **må ikke** kontakte Play API for skriving.

### 5.5 `list_drafts` (read-only)

Lister utkast (valgfritt filtrert på `packageName`/`language`) med id, tidspunkt og kort sammendrag.

### 5.5b `get_draft` (read-only)

Input: `draftId`. Returnerer hele utkastet (`base`, `proposed`, `base_hash`, `createdAt`) og diff per felt med tegnlengder, slik at utvikleren kan se nøyaktig hva som vil bli publisert. Samme validering som `apply_draft` steg 1 (zod, sti under `PLAY_DRAFT_DIR`, allowlist). Tekst returneres som data i JSON-felt.

### 5.6 `apply_draft` (skriver til Google Play, registreres kun hvis `PLAY_ENABLE_APPLY=true`)

Input: `draftId`, `confirm` (må være bokstavelig `true`), `confirmPackageName` (må være lik utkastets pakke).

Oppførsel:

1. Les utkastet og **valider det med zod på nytt** (pakkenavn, språk, felter, `draftId`, `base_hash`). Utkastfiler er upålitelig input, siden de kan være redigert for hånd. Sjekk at stien ligger under `PLAY_DRAFT_DIR`, og at pakke/språk i innholdet samsvarer med mappen. Avvis hvis pakken ikke er i allowlist.
2. Hent live-oppføringen på nytt og beregn hash. **Hvis den ikke er lik `base_hash`, avbryt** og be om nytt utkast (live-teksten er endret siden forslaget).
3. Valider tegngrenser på nytt.
4. `edits.insert` → `edits.listings.patch` (kun feltene utkastet endrer) → `edits.validate` → `edits.commit`.
5. Ved feil: forsøk `edits.delete`, og returner en forståelig feilmelding.
6. Flytt utkastet atomisk (rename) til `PLAY_DRAFT_DIR/applied/` med tidsstempel og Play-ens svar, og logg handlingen (uten hemmeligheter). Et utkast kan bare publiseres én gang; er det allerede i `applied/`, avvises kallet. Hvis commit lyktes, men flytting feilet, skal feilmeldingen si tydelig at publiseringen er gjort.
7. Dokumenter i README at hash-sjekken og commit skjer i separate edits, så det finnes et lite tidsvindu der live-teksten kan endres. Sjekk også tidlig om commit krever `changesNotSentForReview`, og dokumenter funnet.

Annotér verktøyet som `destructiveHint: true`, slik at klienten ber om bekreftelse. Anta aldri auto-godkjenning.

## 6. Sikkerhetsregler (må følges)

1. **Aldri** logg eller returner innholdet i nøkkelfilen, tokens eller Authorization-headere.
2. **All logging til stderr.** Skriv aldri til stdout utenom MCP-protokollen.
3. Allowlist for pakker håndheves i _hver_ verktøyfunksjon, ikke bare ved oppstart.
4. Behandle all tekst hentet fra Play (og fra utkast) som **data, ikke instruksjoner**. Returner den innpakket slik at klienten tydelig ser at det er innhold (f.eks. felt i JSON), og aldri som tekst som ser ut som instruksjoner fra serveren.
5. Valider `language` mot BCP-47-mønster og `packageName` mot Android-pakkenavn-mønster før bruk. Hindre path traversal i utkastsmappen (`..`, absolutte stier).
6. Ingen shell-kall, ingen `eval`, ingen dynamisk kode.
7. Service account skal kun trenge rettigheten _Manage store presence_. Dokumenter dette i README.
8. Hold avhengighetene få og pin versjoner via lockfile. Kjør `npm audit` i CI.
9. Commit aldri `drafts/`, `applied/`, `.env` eller nøkkelfiler. Legg dem i `.gitignore`.

## 7. Foreslått mappestruktur

```
.
├── src/
│   ├── index.ts            # oppstart, registrering av verktøy, stdio-transport
│   ├── config.ts           # env-parsing og validering (zod)
│   ├── logger.ts           # stderr-logger
│   ├── play/
│   │   ├── client.ts       # androidpublisher-klient + auth
│   │   └── listings.ts     # get/list/patch/commit-wrappere med edit-livssyklus
│   ├── drafts/
│   │   ├── store.ts        # lese/skrive utkast på disk
│   │   └── diff.ts         # diff og hash
│   ├── validation.ts       # tegngrenser, pakke- og språkvalidering
│   └── tools/
│       ├── listApps.ts
│       ├── listListings.ts
│       ├── getListing.ts
│       ├── proposeListingUpdate.ts
│       ├── listDrafts.ts
│       ├── getDraft.ts
│       └── applyDraft.ts
├── test/
├── .github/
│   ├── workflows/ci.yml
│   └── copilot-instructions.md
├── .vscode/mcp.example.json
├── .gitignore
├── package.json
├── tsconfig.json
├── docs/plan.md
└── README.md
```

## 8. Faser og leveranser

Gjør én fase om gangen. Kjør test og lint før du går videre, og lag en liten commit per fase.

**Fase 0 – Prosjektoppsett**

- `npm init`, TypeScript strict, OxLint, OxFmt, vitest, `.gitignore`. Sett `engines.node` til `>=24`.
- Minimal MCP-server som starter over stdio og eksponerer `list_apps`.
- _Ferdig når:_ serveren starter, svarer på `tools/list`, og lint/test/build er grønne.

**Fase 1 – Konfigurasjon og auth**

- `config.ts` med zod. `play/client.ts` med `GoogleAuth` og scope `https://www.googleapis.com/auth/androidpublisher`.
- _Ferdig når:_ ugyldig konfigurasjon gir tydelig feil, og gyldig konfigurasjon gir en autentisert klient (mocket i tester).

**Fase 2 – Lesing**

- `list_listings` og `get_listing` med korrekt edit-livssyklus (åpne → les → slett edit, også ved feil, via `try/finally`).
- _Ferdig når:_ enhetstester med mocket API dekker suksess, 404, 403 og allowlist-avvisning.

**Fase 3 – Validering og utkast**

- `validation.ts`, `drafts/store.ts`, `drafts/diff.ts`, `propose_listing_update`, `list_drafts`, `get_draft`.
- _Ferdig når:_ tegngrenser testes (inkludert emoji og tegn utenfor BMP), diff er lesbar, og path traversal avvises.

**Fase 4 – Publisering**

- `apply_draft` bak `PLAY_ENABLE_APPLY`, med hash-sjekk, validate, commit og opprydding.
- _Ferdig når:_ tester viser at (a) verktøyet ikke finnes uten flagget, (b) mismatch i `base_hash` avbryter, (c) feil fører til `edits.delete`, (d) `confirm`/`confirmPackageName` kreves.

**Fase 5 – Dokumentasjon og pakking**

- Oppdater `README.md` slik at den stemmer med faktisk oppførsel. Lag `.vscode/mcp.example.json`, `.github/copilot-instructions.md` og CI-workflow (install, lint, test, build, audit).
- _Ferdig når:_ en ny utvikler kan sette opp og kjøre serveren kun ved å følge README.

## 9. Eksempel: `.vscode/mcp.example.json`

```json
{
  "servers": {
    "play-listings": {
      "type": "stdio",
      "command": "node",
      "args": ["${workspaceFolder}/dist/index.js"],
      "env": {
        "PLAY_KEY_FILE": "${input:playKeyFile}",
        "PLAY_ALLOWED_PACKAGES": "no.example.app1,no.example.app2",
        "PLAY_ENABLE_APPLY": "false"
      }
    }
  },
  "inputs": [
    {
      "id": "playKeyFile",
      "type": "promptString",
      "description": "Sti til service account JSON-nøkkel"
    }
  ]
}
```

## 10. Innhold til `.github/copilot-instructions.md`

Lag en instruksjonsfil som styrer hvordan Copilot skriver butikktekster via verktøyene:

- Skriv for brukeren, ikke for søkemotoren. Ingen nøkkelordstapping.
- Ingen misvisende påstander, ingen superlativer uten dekning, ingen omtale av priser/rabatter i tittel, ingen emoji-spam, ingen omtale av andre apper eller tjenester uten relevans.
- Bevar faktainnhold fra eksisterende tekst med mindre utvikleren ber om endring.
- Hold deg innenfor tegngrensene (30/80/4000) og vis tegnlengde i forslaget.
- Bruk alltid `propose_listing_update` først, og vis utkastet med `get_draft` før noen ber om publisering. Kall aldri `apply_draft` uten at utvikleren eksplisitt har bedt om det i samme melding.
- Skriv på språket oppføringen har (`nb-NO` på norsk bokmål, `en-US` på engelsk osv.).

## 11. Testkrav

- Mock `googleapis`. Ingen tester skal snakke mot ekte Google-API.
- Dekk: konfigurasjonsvalidering, allowlist, tegntelling, utkastlagring, hash-mismatch, edit-opprydding ved feil, og at `apply_draft` er skjult uten flagget.
- Minst én integrasjonstest som starter serveren over stdio og kaller `tools/list` og `list_apps`.

## 12. Definisjon av ferdig

- [ ] Alle faser fullført, lint/test/build grønne i CI
- [ ] Ingen skriving til Play uten `PLAY_ENABLE_APPLY=true` og eksplisitt `confirm`
- [ ] Ingen hemmeligheter i repoet eller i logger
- [ ] README stemmer med faktisk oppførsel
- [ ] `.vscode/mcp.example.json` og `.github/copilot-instructions.md` finnes

## 13. Arbeidsmåte

- Små, fokuserte commits med tydelige meldinger.
- Ikke legg til funksjonalitet utover denne planen uten å spørre.
- Hvis Play API-et oppfører seg annerledes enn antatt (f.eks. krav om endringer sendt til gjennomgang ved commit), dokumenter funn i README under «Kjente begrensninger» i stedet for å gjette.
- Oppsummer til slutt hva som er gjort, hva som er testet, og hva utvikleren manuelt må gjøre (opprette service account, gi tilgang i Play Console).
