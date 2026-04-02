# WebSocket: Stream Active Contracts

Canton's JSON API v2 HTTP endpoint (`POST /v2/state/active-contracts`) limits responses to 200 elements. The WebSocket endpoint at the same path streams **all** matching contracts with no limit.

## Authentication

Canton WebSocket uses **subprotocols** for authentication (not HTTP headers):

- `jwt.token.<your-jwt-token>` — the JWT access token
- `daml.ws.auth` — identifies the auth protocol

## Query Filters

After connecting, send a single JSON message with the query filter. The WebSocket supports the same filter types as the HTTP API.

### Wildcard (all contracts)

Streams every active contract visible to any party on the participant:

```json
{
  "filter": {
    "filtersForAnyParty": {
      "cumulative": [{
        "identifierFilter": {
          "WildcardFilter": {
            "value": { "includeCreatedEventBlob": false }
          }
        }
      }]
    }
  },
  "verbose": false,
  "activeAtOffset": 12345
}
```

### By party + wildcard

Streams all contracts for a specific party:

```json
{
  "filter": {
    "filtersByParty": {
      "<party-id>::<party-fingerprint>": {
        "cumulative": [{
          "identifierFilter": {
            "WildcardFilter": {
              "value": { "includeCreatedEventBlob": false }
            }
          }
        }]
      }
    }
  },
  "verbose": true,
  "activeAtOffset": 12345
}
```

### By party + template

Streams only contracts matching a specific template for a party. This is the most targeted query — useful for streaming large template sets (e.g., 26K TradeProposal contracts) that exceed the HTTP 200 limit:

```json
{
  "filter": {
    "filtersByParty": {
      "<party-id>": {
        "cumulative": [{
          "identifierFilter": {
            "TemplateFilter": {
              "value": {
                "templateId": "<package-hash>:<Module>:<Entity>",
                "includeCreatedEventBlob": false
              }
            }
          }
        }]
      }
    }
  },
  "verbose": true,
  "activeAtOffset": 12345
}
```

### Filter parameters

| Parameter | Description |
| --------- | ----------- |
| `filtersForAnyParty` | Match contracts visible to any party on the participant |
| `filtersByParty` | Match contracts for specific party IDs |
| `WildcardFilter` | Match all templates |
| `TemplateFilter` | Match a specific `packageHash:Module:Entity` template ID |
| `activeAtOffset` | Ledger offset snapshot (get from `GET /v2/state/ledger-end`) |
| `verbose` | `true` includes full contract arguments; `false` for faster streaming |
| `includeCreatedEventBlob` | Include binary event blob (usually `false`) |

### Response format

Each WebSocket message is a single JSON object representing one contract:

```json
{
  "workflowId": "...",
  "contractEntry": {
    "JsActiveContract": {
      "createdEvent": {
        "offset": 19539,
        "contractId": "00abc...",
        "templateId": "<package-hash>:Splice.Amulet:Amulet",
        "packageName": "splice-amulet",
        "signatories": ["DSO::1220..."],
        "observers": ["kairo-mainnet::1220..."],
        "createArgument": { ... }
      }
    }
  }
}
```

The connection closes with code `1000` when all matching contracts have been streamed.

---

## Console (Node.js)

Requires the `ws` package (`npm install ws` or run from a project that has it).

### Step 1: Get an auth token

**OAuth2 (remote nodes):**

```bash
# Replace with your OAuth2 provider URL and credentials
TOKEN=$(curl -s -X POST "https://<your-oauth2-provider>/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=client_credentials&client_id=<your-client-id>&client_secret=<your-client-secret>&audience=<your-audience>" \
  | node -e "process.stdin.on('data',d=>console.log(JSON.parse(d).access_token))")

echo "Token: ${TOKEN:0:30}..."
```

**Shared-secret (local nodes):**

```bash
TOKEN=$(node -e "
const{SignJWT}=require('jose');
new SignJWT({sub:'ledger-api-user',aud:'https://canton.network.global',iss:'unsafe-auth'})
  .setProtectedHeader({alg:'HS256',typ:'JWT'})
  .setIssuedAt()
  .setExpirationTime('1h')
  .sign(new TextEncoder().encode('unsafe'))
  .then(t=>console.log(t))
")
```

### Step 2: Get the current ledger offset

```bash
OFFSET=$(curl -s -H "Authorization: Bearer $TOKEN" \
  "https://<your-json-api-host>/v2/state/ledger-end" \
  | node -e "process.stdin.on('data',d=>console.log(JSON.parse(d).offset))")

echo "Offset: $OFFSET"
```

### Step 3: Stream contracts

**Stream all contracts (wildcard):**

```bash
node -e "
const WebSocket = require('ws');
const token = process.argv[1];
const offset = parseInt(process.argv[2]);

// Use ws:// for HTTP nodes, wss:// for HTTPS nodes
const ws = new WebSocket(
  'wss://<your-json-api-host>/v2/state/active-contracts',
  ['jwt.token.' + token, 'daml.ws.auth']
);

let count = 0;
const templates = {};

ws.on('open', () => {
  console.log('Connected. Offset:', offset);
  ws.send(JSON.stringify({
    filter: {
      filtersForAnyParty: {
        cumulative: [{
          identifierFilter: {
            WildcardFilter: { value: { includeCreatedEventBlob: false } }
          }
        }]
      }
    },
    verbose: false,
    activeAtOffset: offset
  }));
});

ws.on('message', (data) => {
  count++;
  const msg = JSON.parse(data.toString());
  const evt = msg?.contractEntry?.JsActiveContract?.createdEvent;
  if (evt?.templateId) {
    const pkg = evt.packageName || '';
    const short = evt.templateId.split(':').pop();
    const key = pkg ? pkg + ':' + short : short;
    templates[key] = (templates[key] || 0) + 1;
  }
  if (count % 5000 === 0) console.log('...', count, 'contracts');
});

ws.on('close', (code) => {
  console.log('\nDone. Code:', code, 'Total:', count);
  const sorted = Object.entries(templates).sort((a, b) => b[1] - a[1]);
  console.log('Templates (' + sorted.length + '):');
  for (const [name, c] of sorted) console.log('  ' + c + '\t' + name);
});

ws.on('error', (err) => console.error('Error:', err.message));
setTimeout(() => { console.log('Timeout, got', count); process.exit(0); }, 120000);
" "$TOKEN" "$OFFSET"
```

**Stream a specific template:**

```bash
PARTY="<party-id>::<party-fingerprint>"
TEMPLATE="<package-hash>:<Module>:<Entity>"

node -e "
const WebSocket = require('ws');
const token = process.argv[1];
const offset = parseInt(process.argv[2]);
const party = process.argv[3];
const templateId = process.argv[4];

const ws = new WebSocket(
  'wss://<your-json-api-host>/v2/state/active-contracts',
  ['jwt.token.' + token, 'daml.ws.auth']
);

const contracts = [];

ws.on('open', () => {
  console.log('Streaming template:', templateId.split(':').pop());
  ws.send(JSON.stringify({
    filter: {
      filtersByParty: {
        [party]: {
          cumulative: [{
            identifierFilter: {
              TemplateFilter: {
                value: { templateId, includeCreatedEventBlob: false }
              }
            }
          }]
        }
      }
    },
    verbose: true,
    activeAtOffset: offset
  }));
});

ws.on('message', (data) => {
  contracts.push(JSON.parse(data.toString()));
  if (contracts.length % 1000 === 0) console.log('...', contracts.length);
});

ws.on('close', () => {
  console.log('Done. Total:', contracts.length, 'contracts');
});

ws.on('error', (err) => console.error('Error:', err.message));
setTimeout(() => { console.log('Timeout, got', contracts.length); process.exit(0); }, 120000);
" "$TOKEN" "$OFFSET" "$PARTY" "$TEMPLATE"
```

### Full one-liner (local node, shared-secret)

```bash
cd /path/to/canton-local-inspector && \
TOKEN=$(node -e "const{SignJWT}=require('jose');new SignJWT({sub:'ledger-api-user',aud:'https://canton.network.global',iss:'unsafe-auth'}).setProtectedHeader({alg:'HS256',typ:'JWT'}).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode('unsafe')).then(t=>console.log(t))") && \
OFFSET=$(curl -s -H "Authorization: Bearer $TOKEN" "http://localhost:4975/v2/state/ledger-end" | node -e "process.stdin.on('data',d=>console.log(JSON.parse(d).offset))") && \
echo "Offset: $OFFSET" && \
node -e "const W=require('ws'),t=process.argv[1],o=parseInt(process.argv[2]),w=new W('ws://localhost:4975/v2/state/active-contracts',['jwt.token.'+t,'daml.ws.auth']);let n=0,m={};w.on('open',()=>{console.log('Connected');w.send(JSON.stringify({filter:{filtersForAnyParty:{cumulative:[{identifierFilter:{WildcardFilter:{value:{includeCreatedEventBlob:false}}}}]}},verbose:false,activeAtOffset:o}))});w.on('message',d=>{n++;const e=JSON.parse(d.toString())?.contractEntry?.JsActiveContract?.createdEvent;if(e?.templateId){const k=(e.packageName||'')+':'+e.templateId.split(':').pop();m[k]=(m[k]||0)+1}if(n%1000===0)console.log('...',n)});w.on('close',c=>{console.log('Done:',n);Object.entries(m).sort((a,b)=>b[1]-a[1]).forEach(([k,v])=>console.log(v,k))});w.on('error',e=>console.error(e.message));setTimeout(()=>process.exit(0),60000)" "$TOKEN" "$OFFSET"
```

---

## Postman

### Step 1: Get an auth token

Create a regular HTTP **POST** request:

- **URL**: `https://<your-oauth2-provider>/token`
- **Body** (x-www-form-urlencoded):

| Key             | Value                  |
| --------------- | ---------------------- |
| `grant_type`    | `client_credentials`   |
| `client_id`     | `<your-client-id>`     |
| `client_secret` | `<your-client-secret>` |
| `audience`      | `<your-audience>`      |

Copy the `access_token` from the response.

### Step 2: Get the current ledger offset

- **GET** `https://<your-json-api-host>/v2/state/ledger-end`
- **Headers**: `Authorization: Bearer <your-token>`

Note the `offset` value from the response.

### Step 3: Connect via WebSocket

1. Click **New** > **WebSocket**

2. Enter the URL:

   ```text
   wss://<your-json-api-host>/v2/state/active-contracts
   ```

   Use `ws://` for HTTP nodes (local dev).

3. Go to the **Headers** tab and add:

   | Key                      | Value                                          |
   | ------------------------ | ---------------------------------------------- |
   | `Sec-WebSocket-Protocol` | `jwt.token.<your-token>, daml.ws.auth`         |

   Replace `<your-token>` with the full JWT from step 1. Note the comma and space between the two protocol values.

4. Click **Connect**

5. Go to the **Message** tab, paste the query JSON, and click **Send**.

### Postman: Stream all contracts (wildcard)

```json
{
  "filter": {
    "filtersForAnyParty": {
      "cumulative": [{
        "identifierFilter": {
          "WildcardFilter": {
            "value": { "includeCreatedEventBlob": false }
          }
        }
      }]
    }
  },
  "verbose": false,
  "activeAtOffset": 12345
}
```

Replace `12345` with the offset from step 2.

### Postman: Stream a specific template

```json
{
  "filter": {
    "filtersByParty": {
      "<party-id>::<party-fingerprint>": {
        "cumulative": [{
          "identifierFilter": {
            "TemplateFilter": {
              "value": {
                "templateId": "<package-hash>:<Module>:<Entity>",
                "includeCreatedEventBlob": false
              }
            }
          }
        }]
      }
    }
  },
  "verbose": true,
  "activeAtOffset": 12345
}
```

Contracts stream in the **Response** panel, one message per contract. The connection closes when done.

---

## Recommended Usage Strategy

| Scenario | Method | Why |
| -------- | ------ | --- |
| Template indexing (cron job) | WebSocket wildcard | Discovers all templates, no limit, runs server-side |
| Small template (<200 contracts) | HTTP POST | Fast single request, no connection overhead |
| Large template (>200 contracts) | WebSocket + TemplateFilter | Streams all contracts for that template |
| Browse all contracts on a party | WebSocket + party wildcard | Streams everything for one party |

**Client-side fallback pattern**: Try HTTP first (fast). If the response is a 413/limit error, automatically fall back to a WebSocket stream for that specific template. This minimizes overhead — WebSocket is only used when needed.

---

## Notes

- **No element limit** — WebSocket streams all matching contracts regardless of count
- **Targeted queries** — Use `TemplateFilter` to stream only one template instead of the entire ledger
- **Memory** — Large wildcard streams can return 50K+ contracts. Process incrementally via `onmessage`
- **Timeout** — Wildcard streams on mainnet can take 30-60s for 50K contracts. Template-specific streams are faster
- **Connection close** — Normal completion uses WebSocket close code `1000`
- **Local nodes** — Use `ws://localhost:<port>/v2/state/active-contracts`
- **Remote nodes (HTTPS)** — Use `wss://<host>/v2/state/active-contracts`
- **No CORS restriction** — Browser WebSocket connections are not subject to same-origin policy
