# @refarm.dev/localization-v1

Small, surface-neutral localization substrate for apps and plugins. It resolves an explicit
operator locale before browser preferences, falls back to English, formats named parameters,
and exposes catalog-parity diagnostics.

Human-facing labels are translated; operation ids, capability ids and workspace ids remain
canonical. Dates, numbers and relative time should use the platform `Intl` APIs. This package
does not implement a partial ICU grammar; adopt MessageFormat when a concrete plural/select
message requires it.
