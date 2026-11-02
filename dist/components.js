// Data-oriented component definitions (DESIGN.md §2.2).
// Components are plain data. No system logic lives here.
export var FsmState;
(function (FsmState) {
    FsmState["PATROLLING"] = "PATROLLING";
    FsmState["JUMPING"] = "JUMPING";
    FsmState["LAUNCHED"] = "LAUNCHED";
    FsmState["FALLING"] = "FALLING";
    FsmState["WALL_SLIDING"] = "WALL_SLIDING";
})(FsmState || (FsmState = {}));
// --- Window archetypes (DESIGN.md Part 5) ---------------------------------
// Each window's software role gives it a distinct platforming behavior. The
// `kind` selects which branch the ArchetypeSystem and the collision overrides
// take. `Archetype` carries all per-kind mutable state in one plain struct so
// the ECS store stays data-oriented (unused fields are simply ignored).
export var WindowKind;
(function (WindowKind) {
    WindowKind["PLAIN"] = "PLAIN";
    WindowKind["TERMINAL"] = "TERMINAL";
    WindowKind["MEDIA"] = "MEDIA";
    WindowKind["EDITOR"] = "EDITOR";
    WindowKind["BSOD"] = "BSOD";
    // --- Kernel Run game roles ---
    WindowKind["SPAWN"] = "SPAWN";
    WindowKind["SINK"] = "SINK";
    WindowKind["ALERT"] = "ALERT";
})(WindowKind || (WindowKind = {}));
//# sourceMappingURL=components.js.map