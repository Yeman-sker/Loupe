# Loupe Context

Loupe turns a user-selected DOM element on a local development page into a structured task that an AI coding agent can read, act on, and resolve.

## Language

**Local daemon**:
A local Loupe service that brokers browser and agent access to marks across one or more projects. It is not itself a project identity.
_Avoid_: Project daemon, workspace-bound daemon

**Project**:
A code workspace scope that owns marks and agent actions. Project identity is distinct from browser origin, route, and daemon process identity.
_Avoid_: URL, origin, daemon
