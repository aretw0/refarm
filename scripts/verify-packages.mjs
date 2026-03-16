import { loadConfig } from "@refarm.dev/config";
import { FenceCore } from "@refarm.dev/fence";
import { SiloCore } from "@refarm.dev/silo";
import { ThresherCore } from "@refarm.dev/thresher";
import { WindmillEngine } from "@refarm.dev/windmill";
import { HealthCore } from "@refarm.dev/health";

async function verify() {
  console.log("🚀 Deterministic Verification Starting...");

  // 1. Config
  try {
    const config = loadConfig();
    console.log("✅ Config: Package resolved.");
  } catch (e) {
    console.error("❌ Config: Failed.", e.message);
  }

  // 2. Silo
  try {
    const silo = new SiloCore({});
    console.log("✅ Silo: Package resolved.");
  } catch (e) {
    console.error("❌ Silo: Failed.", e.message);
  }

  // 3. Windmill
  try {
    const windmill = new WindmillEngine({}, {});
    console.log("✅ Windmill: Package resolved.");
  } catch (e) {
    console.error("❌ Windmill: Failed.", e.message);
  }

  // 4. Fence
  try {
    const fence = new FenceCore(".", {});
    console.log("✅ Fence: Package resolved.");
  } catch (e) {
    console.error("❌ Fence: Failed.", e.message);
  }

  // 5. Thresher
  try {
    const thresher = new ThresherCore(".", {});
    console.log("✅ Thresher: Package resolved.");
  } catch (e) {
    console.error("❌ Thresher: Failed.", e.message);
  }

  // 6. Health
  try {
    const health = new HealthCore();
    console.log("✅ Health: Package resolved.");
  } catch (e) {
    console.error("❌ Health: Failed.", e.message);
  }

  console.log("🏁 Verification Finished.");
}

verify();
