# Unit tests

This folder is the `unit` project in `vitest.config.ts`. `npm test` runs it
beside `tests/integration` and `tests/eval`. `tests/setup.ts` replaces
`server/db.ts` with stubs and gives each file its own temp `DATA_DIR`, so a
unit test never opens a real database. A test that needs real SQLite, a route
or a migration belongs in `tests/integration`.

## Where a test goes

The first folder names the code root. The second folder names the area.

| Folder             | Tests the code in                                                                                                                                       |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `server/<area>/`   | `server/`: `ai`, `ai-search`, `auth`, `connectors`, `dedupe`, `http`, `nlp`, `repositories`, `search`, `services`, `tenancy`, `utils`                   |
| `frontend/<area>/` | `src/`: one folder for each feature (`map`, `pulse`, `settings`, ...) and for each shared layer (`api`, `hooks`, `lib`, `ui`, `style`)                  |
| `shared/`          | `shared/`                                                                                                                                               |
| `scripts/`         | `scripts/`                                                                                                                                              |
| `repo/`            | The files that hold the repository together: the Dockerfile, the Node version pins, native TypeScript, the environment docs and the test database guard |

A file takes the name of the module it tests, or the name of the feature when
it tests several modules. The folder already names the area, so the file name
does not repeat it. For example, the map's flyTo tests are
`frontend/map/flyTo.test.ts`, not `map.flyTo.test.ts`.
