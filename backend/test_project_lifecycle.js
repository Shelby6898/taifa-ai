require("dotenv").config();

const fs = require("fs");
const path = require("path");
const http = require("http");
const jwt = require("jsonwebtoken");

const USER_ID = "lifecycle-test-student";
const PROJECT = "lifecycle-test-project";
const PORT = 5000;
const BASE = `http://localhost:${PORT}`;

const JWT_SECRET =
  process.env.JWT_SECRET || "dev-secret-change-in-production";

const token = jwt.sign(
  { id: USER_ID },
  JWT_SECRET,
  { expiresIn: "1h" }
);

const headers = {
  Authorization: `Bearer ${token}`,
  "Content-Type": "application/json"
};

function request(method, requestPath, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(requestPath, BASE);

    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method,
        headers
      },
      (res) => {
        let data = "";

        res.on("data", (chunk) => {
          data += chunk;
        });

        res.on("end", () => {
          let parsed;

          try {
            parsed = JSON.parse(data);
          } catch {
            parsed = data;
          }

          resolve({
            status: res.statusCode,
            body: parsed
          });
        });
      }
    );

    req.on("error", reject);

    if (body !== undefined) {
      req.write(JSON.stringify(body));
    }

    req.end();
  });
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${message}`);
  }
}

function workspacePath() {
  return path.join(
    __dirname,
    "..",
    "workspace",
    "lifecycle-test-student",
    "lifecycle-test-project"
  );
}

async function main() {
  console.log("=== 1. Disposable project cleanup before test ===");

  const workspace = workspacePath();

  if (fs.existsSync(workspace)) {
    fs.rmSync(workspace, { recursive: true, force: true });
    console.log("Removed stale workspace.");
  }

  console.log("\n=== 2. CREATE project through HTTP API ===");

  const create = await request("POST", "/api/projects", {
    projectName: PROJECT
  });

  console.log(JSON.stringify(create.body, null, 2));

  assert(create.status === 201, `Expected 201, got ${create.status}`);
  assert(create.body.success === true, "Creation should succeed");
  assert(
    create.body.projectName === PROJECT,
    "Returned project name should match"
  );
  assert(
    create.body.workspaceCreated === true,
    "Workspace should be reported as created"
  );
  assert(
    fs.existsSync(workspace),
    "Workspace directory should exist after creation"
  );

  console.log("✅ CREATE passed");

  console.log("\n=== 3. LIST projects ===");

  const list = await request("GET", "/api/projects");

  console.log(JSON.stringify(list.body, null, 2));

  assert(list.status === 200, `Expected 200, got ${list.status}`);
  assert(list.body.success === true, "List should succeed");
  assert(
    list.body.projects.includes(PROJECT),
    "Created project should appear in project list"
  );

  console.log("✅ LIST passed");

  console.log("\n=== 4. DUPLICATE creation must be rejected ===");

  const duplicate = await request("POST", "/api/projects", {
    projectName: PROJECT
  });

  console.log(JSON.stringify(duplicate.body, null, 2));

  assert(
    duplicate.status === 409,
    `Expected 409 for duplicate, got ${duplicate.status}`
  );
  assert(
    duplicate.body.success === false,
    "Duplicate creation must fail"
  );

  console.log("✅ DUPLICATE protection passed");

  console.log("\n=== 5. DELETE project through HTTP API ===");

  const deleted = await request(
    "DELETE",
    `/api/projects/${encodeURIComponent(PROJECT)}?confirm=true`
  );

  console.log(JSON.stringify(deleted.body, null, 2));

  assert(
    deleted.status === 200,
    `Expected 200 for deletion, got ${deleted.status}`
  );
  assert(
    deleted.body.success === true,
    "Deletion should succeed"
  );
  assert(
    deleted.body.workspaceDeleted === true,
    "Workspace should be deleted"
  );
  assert(
    !fs.existsSync(workspace),
    "Workspace directory must no longer exist"
  );

  console.log("✅ DELETE passed");

  console.log("\n=== 6. Project must disappear from LIST ===");

  const finalList = await request("GET", "/api/projects");

  console.log(JSON.stringify(finalList.body, null, 2));

  assert(finalList.status === 200, `Expected 200, got ${finalList.status}`);
  assert(
    !finalList.body.projects.includes(PROJECT),
    "Deleted project must not appear in project list"
  );

  console.log("✅ FINAL LIST passed");

  console.log("\n=== 7. Recreate after deletion ===");

  const recreate = await request("POST", "/api/projects", {
    projectName: PROJECT
  });

  console.log(JSON.stringify(recreate.body, null, 2));

  assert(
    recreate.status === 201,
    `Expected 201 after deletion/recreation, got ${recreate.status}`
  );
  assert(
    recreate.body.success === true,
    "Project should be recreatable after deletion"
  );
  assert(
    fs.existsSync(workspace),
    "Workspace should exist after recreation"
  );

  console.log("✅ RECREATE passed");

  console.log("\n=== 8. Final cleanup ===");

  const finalDelete = await request(
    "DELETE",
    `/api/projects/${encodeURIComponent(PROJECT)}?confirm=true`
  );

  assert(finalDelete.status === 200, "Final cleanup deletion failed");
  assert(!fs.existsSync(workspace), "Final workspace cleanup failed");

  console.log("✅ FINAL CLEANUP passed");

  console.log("\n========================================");
  console.log("✅ PROJECT LIFECYCLE TEST PASSED");
  console.log("========================================");
}

main().catch((err) => {
  console.error("\n❌ PROJECT LIFECYCLE TEST FAILED");
  console.error(err.stack || err);
  process.exitCode = 1;
});
