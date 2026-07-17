# adding new templates

To add a new language template (e.g., Python/Django):

1. Create `templates/<language>/` with the same top-level structure as `templates/ruby/`
2. Add the new option to step 1's template field
3. Add the new template's derived values to step 1 (Derived section)
4. Add a scaffold branch for the new template in step 3
5. Update the template variable reference table with any new placeholders
6. Add the new template row to `README.md`

Lessons from the python template:

- Keep workflow YAML var-free by routing commands through the Makefile (a `MODULE := {{APP_MODULE}}`
  variable in `Makefile.tmpl` carries the app name); `${{ github.* }}` expressions are then never at
  risk of colliding with `{{PLACEHOLDER}}` substitution
- Files without `{{VARS}}` should not carry the `.tmpl` extension — copy them verbatim
- Verify against the installed framework version before shipping: scaffold a demo app in a scratch
  directory, then run the full gate (deps, migrations, lint, tests, dev server, docker build)
