# Contributing to Hiraia

Thank you for your interest in contributing to Hiraia! This document provides guidelines and information for contributors.

## Development Setup

### Prerequisites

- **Node.js** >= 20.0.0
- **pnpm** >= 9.0.0 (install: `npm install -g pnpm`)

### Getting Started

1. **Clone the repository**
   ```bash
   git clone https://github.com/helloluis/hiraia.git
   cd hiraia
   ```

2. **Install dependencies**
   ```bash
   pnpm install
   ```

3. **Build all packages**
   ```bash
   pnpm build
   ```

4. **Start development servers**
   ```bash
   pnpm dev
   ```

## Project Structure

This is a **Turborepo monorepo** with the following structure:

```
hiraia/
├── packages/
│   ├── shared/          # Shared types, interfaces, and utilities
│   ├── mobile/          # Expo React Native app (Android APK)
│   ├── web/             # Next.js web demo
│   └── server/          # QVAC server configuration
├── finetuning/          # LoRA training scripts and datasets
├── rag/                 # RAG pipeline and curriculum processing
└── references/          # Raw curriculum materials (gitignored)
```

## Package Guidelines

### Shared Package (`packages/shared`)

This package contains code shared between mobile and web:
- **Types**: TypeScript interfaces and types
- **Engine**: `TutorEngine` interface and implementations
- **Prompts**: System prompts for different languages/grades
- **Curriculum**: DepEd curriculum mappings
- **Utils**: Shared utilities

**Important**: This package should have zero runtime dependencies. It's purely TypeScript types and pure functions.

### Mobile Package (`packages/mobile`)

The main Expo React Native app that will be submitted to the hackathon.
- Uses `@qvac/sdk` for on-device inference
- Implements `LocalEngine` from the shared package
- Targets Android 12+ (API 29)

### Web Package (`packages/web`)

Next.js web demo for judges and visitors.
- Connects to hosted QVAC server via `RemoteEngine`
- Read-only demo (no local inference)

## Code Style

We use **ESLint + Prettier** for code quality. The configuration is strict but fair.

### Running Linters

```bash
# Check for issues
pnpm lint

# Auto-fix issues
pnpm lint:fix

# Format code
pnpm format
```

### TypeScript Guidelines

- **Strict mode** is enabled — no `any` types unless absolutely necessary (and commented)
- Use **type imports** (`import type { Foo } from './foo'`) for types
- Prefer **interfaces** over types for object shapes
- Use **readonly** for immutable properties
- Use **as const** for literal types

### Import Order

Imports are automatically sorted by ESLint. The order is:
1. Built-in Node modules (`fs`, `path`, etc.)
2. External packages (`@qvac/sdk`, `react`, etc.)
3. Internal packages (`@hiraia/shared`, etc.)
4. Parent directories (`../utils`)
5. Sibling files (`./types`)
6. Index files (`./`)

## Testing

We use **Vitest** for unit tests. Each package has its own test suite.

```bash
# Run all tests
pnpm test

# Run tests in watch mode
pnpm test --watch

# Run tests with coverage
pnpm test --coverage
```

### Writing Tests

- Place test files next to the code they test: `foo.test.ts`
- Use descriptive test names: `it('should return error when model is not loaded')`
- Test edge cases and error conditions
- Aim for >80% coverage on shared utilities

## Git Workflow

### Branch Naming

- `feature/` - New features
- `fix/` - Bug fixes
- `docs/` - Documentation only
- `refactor/` - Code refactoring
- `test/` - Adding tests

Examples:
- `feature/tagalog-lora-adapter`
- `fix/mobile-crash-on-model-load`
- `docs/update-implementation-plan`

### Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <description>

[optional body]

[optional footer]
```

Types:
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation
- `style`: Code style (formatting, semicolons, etc.)
- `refactor`: Code refactoring
- `test`: Adding tests
- `chore`: Maintenance tasks

Examples:
```
feat(mobile): add language toggle component

Implement language selector with Tagalog, Cebuano, and English options.
Persists selection to AsyncStorage.

Closes #42
```

```
fix(shared): correct curriculum grade mapping for Grade 7

The quarter mapping was off-by-one for Grade 7 Science.
```

### Pull Requests

1. Create a feature branch from `main`
2. Make your changes
3. Ensure all checks pass:
   ```bash
   pnpm lint
   pnpm type-check
   pnpm test
   pnpm build
   ```
4. Update documentation if needed
5. Submit a PR with a clear description

## Architecture Decisions

All significant architecture decisions are documented in [IMPLEMENTATION.md](./IMPLEMENTATION.md).

If you're proposing a change that affects architecture:
1. Update IMPLEMENTATION.md
2. Add an entry to the Change Log section
3. Explain the rationale in your PR

## Questions?

Open an issue or discussion on GitHub. We're building this in the open and welcome all contributions!

## License

By contributing to Hiraia, you agree that your contributions will be licensed under the Apache 2.0 License.
