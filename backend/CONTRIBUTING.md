# Contributing to Callibrator Backend

Thank you for your interest in contributing to Callibrator Backend!

## Development Setup

### Prerequisites

- Node.js >= 18 (or Bun)
- PostgreSQL 15+
- Redis 7+
- RabbitMQ 3.13+

### Quick Start

```bash
# Install dependencies
npm install

# Copy and configure environment
cp .env.example .env
# Edit .env with your database, Redis, and RabbitMQ credentials

# Run migrations
npm run migrate

# Start development server
npm run dev
```

### Project Structure

```
src/
├── config/          # Database, Redis, RabbitMQ, JWT config
├── controllers/     # Route handlers
├── docs/            # Swagger, documentation
├── middlewares/     # Auth, RBAC, ABAC, validation
├── models/          # Sequelize models
├── routes/          # API route definitions
├── services/        # Business logic
├── templates/       # Email templates
├── utils/           # Helpers, error classes
└── validators/      # Joi validation schemas
```

## Code Style

We use **ESLint** and **Prettier** for code formatting.

```bash
# Run linter
npm run lint

# Fix lint errors
npm run lint:fix

# Check formatting
npm run prettier

# Auto-fix formatting
npm run prettier:fix
```

### Style Guidelines

- **Indentation:** 2 spaces
- **Quotes:** Double quotes
- **Semicolons:** Required
- **Line length:** 80 characters max
- **Commas:** Trailing commas on multiline
- **Naming:** camelCase for variables/functions, PascalCase for classes

## Git Workflow

1. **Create a branch** for your feature/fix
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. **Write tests** for new functionality (when applicable)
   ```bash
   npm test
   ```

3. **Commit with clear messages**
   ```bash
   git commit -m "feat: add tenant backup scheduling"
   ```
   
   Conventional commit prefixes:
   - `feat:` new feature
   - `fix:` bug fix
   - `docs:` documentation changes
   - `refactor:` code refactoring (no feature changes)
   - `test:` adding/updating tests
   - `chore:` maintenance tasks

4. **Push and open a PR**
   ```bash
   git push origin feature/your-feature-name
   ```

## Testing

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:coverage
```

> **Note:** Some test files are excluded from coverage. See `jest.config.js` for details.

## Adding a New Route

1. Create a new controller in `src/controllers/`
2. Create validation schemas in `src/validators/` (if applicable)
3. Define routes in `src/routes/api/`
4. Mount routes in `index.js`
5. Document routes with Swagger JSDoc comments

## Error Handling

All errors should be caught and handled with the `errorHandler` middleware:

```javascript
// Use controllerWrapper for automatic error handling
const { controllerWrapper } = require("../utils/controllerWrapper");

router.get("/items", controllerWrapper(async (req, res, next) => {
  const items = await ItemService.findAll();
  return success(res, items);
}));
```

## Security

- Never commit `.env` files or credentials
- Always validate and sanitize user input
- Use parameterized queries (Sequelize handles this automatically)
- Follow RBAC/ABAC patterns for authorization

## Questions?

If you have questions, open an issue or contact the project maintainer.

---

**Thank you for contributing to Callibrator! 🚀**
