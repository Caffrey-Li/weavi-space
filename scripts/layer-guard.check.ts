import assert from "node:assert/strict";
import { decideClose, isLatestGeneration, visualPhase } from "../apps/web/src/components/ui/layerGuard";

assert.equal(decideClose({ busy: false, dirty: false }), "close");
assert.equal(decideClose({ busy: false, dirty: true }), "confirm-dirty");
assert.equal(decideClose({ busy: true, dirty: false }), "confirm-busy");
assert.equal(decideClose({ busy: true, dirty: true }), "confirm-busy");

assert.equal(isLatestGeneration(2, 2), true);
assert.equal(isLatestGeneration(1, 2), false);

assert.equal(visualPhase(true, "closed"), "opening");
assert.equal(visualPhase(true, "opening"), "opening");
assert.equal(visualPhase(true, "open"), "open");
assert.equal(visualPhase(true, "closing"), "open");
assert.equal(visualPhase(false, "open"), "closing");
assert.equal(visualPhase(false, "closing"), "closing");
assert.equal(visualPhase(false, "closed"), "closed");

console.log("layer-guard ok");
