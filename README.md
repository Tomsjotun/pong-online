# Pong Online

Klassisk Pong för två spelare över nätet. Spelet är en webbapp (PWA) som fungerar bäst i Safari på iPhone – öppna länken och lägg till den på hemskärmen så känns den som en vanlig app.

Först till 7 vinner. Den ena skapar ett spel och får en kort rumskod plus en delningslänk. Den andra öppnar länken eller skriver in koden.

## Spela på iPhone

1. Öppna spelets adress i **Safari** (inte i en app-intern webbläsare).
2. Spelare 1 trycker på **Skapa spel**, delar koden eller länken.
3. Spelare 2 öppnar länken, eller skriver koden och trycker på **Gå med**.
4. Dra med fingret i sidled för att styra din racket (den ligger alltid längst ned på din skärm).
5. När någon vunnit trycker båda på **Spela igen** för en ny match.

### Lägg till på hemskärmen

I Safari: tryck på **Dela** (kvadraten med pilen) och välj **Lägg till på hemskärmen**. Då öppnas spelet i helskärm utan webbläsarens verktygsfält.

## Köra lokalt

Kräver Node.js 18 eller nyare.

```bash
cd pong-online
npm install
npm start
```

Spelet lyssnar på `http://127.0.0.1:3000`. Porten kan ändras med miljövariabeln `PORT`.

Två telefoner på samma nät kan använda datorns lokala IP-adress. För spel över internet behövs en publik URL (se nedan).

## Tester

```bash
npm start          # i en terminal
npm test           # i en annan, mot samma server
```

Testet kopplar upp två WebSocket-klienter, skapar ett rum, går med, väntar tills bollen rört sig och en poäng registrerats, och kontrollerar att en frånkoppling hanteras.

```bash
node test/e2e.js http://127.0.0.1:3000
```

## Starta om på den här maskinen

Servern och den tillfälliga tunneln startas med:

```bash
cd /workspace/pong-online
npm install
./scripts/start.sh
```

Stoppa med `./scripts/stop.sh` och starta sedan om med `./scripts/start.sh`.

Loggar ligger i `logs/server.log` och `logs/tunnel.log`. Den aktuella publika adressen skrivs till `logs/public-url.txt`.

Process-id:n sparas i `pids/`.

## Publik åtkomst

`scripts/start.sh` öppnar en **Cloudflare Quick Tunnel** (`cloudflared tunnel --url …`). Adressen blir typ `https://slumpmässigt-namn.trycloudflare.com`.

**Quick-tunnel-adresser är tillfälliga.** De försvinner när processen avbryts, och en ny start ger en ny slumpmässig URL. De passar för att testa snabbt, inte för att dela en länk som ska leva kvar.

Cloudflare-tunnlar kräver utgående anslutning till Cloudflare Edge på port 7844 (QUIC eller HTTP/2). På vissa nät, bland annat den här agentdatorn, är den porten blockerad. Då startar servern ändå lokalt på port 3000, men det skapas ingen publik URL. Kör då spelet på en egen dator med `./scripts/start.sh`, eller lägg upp det permanent enligt nedan.

### Permanent (gratisnivå)

Lägg upp samma Node-app på till exempel:

- [Render](https://render.com) (Web Service, `npm start`, den port som `PORT` anger)
- [Fly.io](https://fly.io)
- [Railway](https://railway.app)

Alla tre har en gratis- eller lågkostnadsnivå som räcker för ett litet realtidsspel. Pekarna är:

- startkommando: `npm start`
- miljön måste stödja WebSocket (inget som bryter uppgraderingen till `wss`)
- sätt inte en kort idle-timeout om du vill att rum ska överleva några minuters väntan

## Teknik

- Servern (Express + `ws`) äger spellogiken: bollfysik, poäng och vinst, cirka 60 tick per sekund.
- Klienterna ritar på en canvas och skickar bara racketens läge.
- All text i gränssnittet är på svenska.

## Licens

Fritt att använda och ändra för eget bruk.
