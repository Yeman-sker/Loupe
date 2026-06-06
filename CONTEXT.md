# Loupe Context

Loupe turns a user-selected DOM element on a local development page into a structured task that an AI coding agent can read, act on, and resolve.

## Language

**Local daemon**:
A local Loupe service that brokers browser and agent access to marks across one or more projects. It is not itself a project identity.
_Avoid_: Project daemon, workspace-bound daemon

**Project**:
A code workspace scope that owns marks and agent actions. Project identity is distinct from browser origin, route, and daemon process identity.
_Avoid_: URL, origin, daemon


**Loupe in-page surfaces**:
The browser-page UI surfaces that support the mark trust loop: picking a DOM element, composing intent, showing pins and status, inspecting mark detail, listing current marks, and presenting page-level fallback or authorization states. This term excludes CLI, agent plugin, marketplace, and browser-popup experiences.
_Avoid_: Loupe components, all Loupe UI

**Selection frame**:
The transient in-page highlight surface that indicates the current DOM target during picking. It preserves visual continuity as the target changes, so users experience one frame moving between targets rather than unrelated flashes.
_Avoid_: DOM box, hover box

**Intent input**:
The compact in-page input used after picking a DOM target to capture the user's task intent. It prioritizes the required comment, defaults kind to `other`, and keeps secondary classification controls out of the primary path.
_Avoid_: Full composer form, annotation form

**Kind theme**:
The visual treatment associated with an intent kind. It helps users distinguish mark categories in in-page surfaces, but it must not be the only carrier of status or meaning.
_Avoid_: Category color only

**Pin**:
The in-page visual marker for a saved mark. A pin is anchored to its live DOM element and tracks that element's current viewport position; it is not a static marker placed at save-time coordinates. When the element can no longer be located, the pin freezes and reflects drifted/lost rather than following a wrong target.
_Avoid_: Marker, dot, badge