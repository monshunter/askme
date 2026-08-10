export {};

const baseUrl = process.env.ASKME_BASE_URL ?? "http://127.0.0.1:3000";
const email = process.env.ASKME_CANDIDATE_EMAIL;
const password = process.env.ASKME_CANDIDATE_PASSWORD;

if (!email || !password) throw new Error("ASKME_CANDIDATE_EMAIL and ASKME_CANDIDATE_PASSWORD are required");

const login = await fetch(`${baseUrl}/api/auth/login`, {
  method: "POST",
  redirect: "manual",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email, password }),
});
if (login.status !== 200) throw new Error(`Candidate login failed with status ${login.status}`);
const sessionCookie = login.headers.get("set-cookie")?.split(";", 1)[0];
if (!sessionCookie) throw new Error("Candidate login did not return a session cookie");
const authenticatedCookie = sessionCookie;

async function connect(body: Record<string, string>) {
  const response = await fetch(`${baseUrl}/api/materials/connect`, {
    method: "POST",
    headers: { cookie: authenticatedCookie, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = (await response.json()) as {
    data: { material?: { id: string; title: string; kind: string; status: string; visibility: string } } | null;
    error: { code: string; message: string } | null;
  };
  if (response.status !== 201 || !payload.data?.material) throw new Error(`${body.kind} connection failed: ${payload.error?.code ?? response.status}`);
  return payload.data.material;
}

const website = await connect({ kind: "website", url: process.env.ASKME_SMOKE_WEBSITE ?? "https://example.com" });
const github = await connect({ kind: "github", url: process.env.ASKME_SMOKE_GITHUB ?? "https://github.com/openai/openai-node" });
console.log(JSON.stringify({ event: "smoke.connect.completed", materials: [website, github] }));
