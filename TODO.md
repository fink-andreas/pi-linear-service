# TODO - INN-202 native pi extension commands

- [x] Implement slash command handlers in `extensions/pi-linear-service.js` wrapping daemon control functions
- [x] Add command tests for registration, execution, prompts, and failure paths
- [x] Update `npm test` script to include new extension command tests
- [x] Run verification (`npm test` and `LINEAR_API_KEY=test ASSIGNEE_ID=test node index.js`)
