# Contributing to NeKode

Start with the [public project contract](docs/development/project-contract.md). It maps the requirements and contribution rules to their canonical documents. You can use your own editor, agent, tracker, and local instructions.

1. Read the [product requirements](docs/product/requirements.md) and the relevant [feature specification](docs/features/). Check the [architecture](docs/architecture/sdd.md) and [UX/UI contract](docs/UX-UI.md) for the boundaries your change touches.
2. Follow [setup](docs/development/setup.md) to install the Windows toolchain and run the app. Python is needed only for the optional [Plane adapter](adapters/plane/README.md).
3. Agree the scope and use the proportional planning and review rules in the project contract. Keep changes focused and preserve unrelated work.
4. Run the checks appropriate to the changed surface, following [verification guidance](docs/development/ci.md#dobór-weryfikacji). Include the commands, exits, regression evidence, and any unrun checks in your contribution.
5. Follow the [branching model](docs/operations/branching-model.md). External contributions come from a fork, target `main`, and require maintainer review and green CI.

Maintainers publish versions through the separate [release procedure](docs/operations/releases.md). A contribution or approved implementation plan does not authorize publication.

The local `AGENTS.md`, `.agents/` harness, and agent configuration are ignored working files. A clean public clone needs none of them. If you create a personal guide, link to public owners rather than copying project rules into a second contract.
