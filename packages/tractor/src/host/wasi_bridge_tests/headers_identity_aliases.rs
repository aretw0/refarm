    #[test]
    fn sanitized_headers_drop_identity_prefix_aliases() {
        let headers = vec![
            ("content-type".to_string(), "application/json".to_string()),
            ("x-forwarded-user-login".to_string(), "alice".to_string()),
            ("X-REMOTE-USER-NAME".to_string(), "alice".to_string()),
            (" x-auth-user-login ".to_string(), "alice".to_string()),
            (
                "X-AUTHENTICATED-USER-LOGIN".to_string(),
                "alice".to_string(),
            ),
            (" x-end-user-login ".to_string(), "alice".to_string()),
            ("X-USER-LOGIN".to_string(), "alice".to_string()),
            (" x-principal-email ".to_string(), "alice@example.com".to_string()),
            ("X-VERIFIED-USERID".to_string(), "alice-id".to_string()),
        ];
        let out = sanitized_plugin_headers(&headers);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].0, "content-type");
    }

    #[test]
    fn sanitized_headers_drop_ms_aad_header_prefix_aliases() {
        let headers = vec![
            ("content-type".to_string(), "application/json".to_string()),
            ("x-ms-client-principal-claims".to_string(), "...".to_string()),
            (
                "X-MS-TOKEN-AAD-TOKEN-TYPE".to_string(),
                "Bearer".to_string(),
            ),
            (
                " x-ms-token-aad-tenant-id ".to_string(),
                "tenant".to_string(),
            ),
        ];
        let out = sanitized_plugin_headers(&headers);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].0, "content-type");
    }

    #[test]
    fn sanitized_headers_drop_auth_request_prefix_aliases() {
        let headers = vec![
            ("content-type".to_string(), "application/json".to_string()),
            (
                "x-auth-request-claims".to_string(),
                "{\"sub\":\"alice\"}".to_string(),
            ),
            (
                " X-AUTH-REQUEST-TENANT-ID ".to_string(),
                "tenant-evil".to_string(),
            ),
        ];
        let out = sanitized_plugin_headers(&headers);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].0, "content-type");
    }

    #[test]
    fn sanitized_headers_drop_federated_identity_header_prefix_aliases() {
        let headers = vec![
            ("content-type".to_string(), "application/json".to_string()),
            (
                "x-goog-authenticated-user-name".to_string(),
                "accounts.google.com:alice".to_string(),
            ),
            (
                "X-GOOGLE-AUTHENTICATED-USER-NAME".to_string(),
                "accounts.google.com:alice".to_string(),
            ),
            (
                " cf-access-authenticated-user-name ".to_string(),
                "alice".to_string(),
            ),
            (
                "CF-Access-Client-Id".to_string(),
                "cf-access-client-id-evil".to_string(),
            ),
            (
                "cf-access-client-secret".to_string(),
                "cf-access-client-secret-evil".to_string(),
            ),
            (
                "X-CF-Access-Client-Id".to_string(),
                "cf-access-client-id-evil-2".to_string(),
            ),
            ("cf-access-aud".to_string(), "aud-evil".to_string()),
            (
                "x-cf-access-jwt-assertion".to_string(),
                "jwt-evil".to_string(),
            ),
            ("X-AMZN-OIDC-SUB".to_string(), "alice-sub".to_string()),
        ];
        let out = sanitized_plugin_headers(&headers);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].0, "content-type");
    }

    #[test]
    fn sanitized_headers_drop_observability_auth_headers() {
        let headers = vec![
            ("content-type".to_string(), "application/json".to_string()),
            ("x-datadog-api-key".to_string(), "dd-api-key-evil".to_string()),
            (
                "X-Honeycomb-Team".to_string(),
                "honeycomb-team-key-evil".to_string(),
            ),
            (
                "x-newrelic-api-key".to_string(),
                "newrelic-key-evil".to_string(),
            ),
            ("X-Logdna-Apikey".to_string(), "logdna-key-evil".to_string()),
            (
                "x-rollbar-access-token".to_string(),
                "rollbar-token-evil".to_string(),
            ),
            ("X-Bugsnag-Api-Key".to_string(), "bugsnag-key-evil".to_string()),
            (
                "x-pagerduty-token".to_string(),
                "pagerduty-token-evil".to_string(),
            ),
            ("X-Grafana-Api-Key".to_string(), "grafana-key-evil".to_string()),
            (
                "x-datadog-application-key".to_string(),
                "dd-app-key-evil".to_string(),
            ),
            ("x-honeycomb-dataset".to_string(), "hny-dataset-evil".to_string()),
            (
                "x-newrelic-license-key".to_string(),
                "nr-license-key-evil".to_string(),
            ),
            (
                "x-rollbar-environment".to_string(),
                "rollbar-env-evil".to_string(),
            ),
            (
                "x-bugsnag-release-stage".to_string(),
                "bugsnag-stage-evil".to_string(),
            ),
            (
                "x-pagerduty-service-id".to_string(),
                "pagerduty-service-evil".to_string(),
            ),
            (
                "x-grafana-stack-id".to_string(),
                "grafana-stack-evil".to_string(),
            ),
            (
                "x-logdna-host".to_string(),
                "logdna-host-evil".to_string(),
            ),
            ("x-otlp-api-key".to_string(), "otlp-api-key-evil".to_string()),
            (
                "x-otlp-endpoint".to_string(),
                "https://otlp.evil".to_string(),
            ),
            (
                "x-otel-exporter-otlp-endpoint".to_string(),
                "https://otel.evil".to_string(),
            ),
            ("x-sentry-token".to_string(), "sentry-token-evil".to_string()),
            (
                "x-sendgrid-account-id".to_string(),
                "sendgrid-account-evil".to_string(),
            ),
            (
                "x-mailgun-domain".to_string(),
                "mg.evil.example".to_string(),
            ),
            (
                "x-postmark-message-stream".to_string(),
                "postmark-stream-evil".to_string(),
            ),
            (
                "x-resend-audience-id".to_string(),
                "resend-audience-evil".to_string(),
            ),
        ];
        let out = sanitized_plugin_headers(&headers);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].0, "content-type");
    }

    #[test]
    fn sanitized_headers_drop_tunnel_and_social_auth_headers() {
        let headers = vec![
            ("content-type".to_string(), "application/json".to_string()),
            ("ngrok-authtoken".to_string(), "ngrok-token-evil".to_string()),
            ("x-ngrok-edge-id".to_string(), "edge-evil".to_string()),
            (
                "X-Tailscale-Authkey".to_string(),
                "tskey-auth-evil".to_string(),
            ),
            (
                "x-tailscale-node-id".to_string(),
                "tailscale-node-evil".to_string(),
            ),
            (
                "x-ts-control-url".to_string(),
                "https://controlplane.evil-ts".to_string(),
            ),
            (
                "x-telegram-bot-api-secret-token".to_string(),
                "telegram-secret-evil".to_string(),
            ),
            (
                "X-Telegram-Api-Hash".to_string(),
                "telegram-api-hash-evil".to_string(),
            ),
            (
                "x-telegram-chat-id".to_string(),
                "123456789".to_string(),
            ),
            ("x-supabase-api-key".to_string(), "sb-key-evil".to_string()),
            (
                "X-Metabase-Session".to_string(),
                "metabase-session-evil".to_string(),
            ),
            (
                "x-twitter-bearer-token".to_string(),
                "twitter-bearer-token-evil".to_string(),
            ),
            (
                "X-Twitter-Webhooks-Signature".to_string(),
                "twitter-signature-evil".to_string(),
            ),
            (
                "x-facebook-signature".to_string(),
                "facebook-signature-evil".to_string(),
            ),
            (
                "X-Facebook-AppSecret-Proof".to_string(),
                "facebook-appsecret-proof-evil".to_string(),
            ),
            (
                "X-Whatsapp-Signature".to_string(),
                "whatsapp-signature-evil".to_string(),
            ),
            (
                "x-whatsapp-token".to_string(),
                "whatsapp-token-evil".to_string(),
            ),
            (
                "X-Instagram-Signature".to_string(),
                "instagram-signature-evil".to_string(),
            ),
            (
                "x-meta-signature".to_string(),
                "meta-signature-evil".to_string(),
            ),
            (
                "x-cloudflare-tunnel-token".to_string(),
                "cf-tunnel-token-evil".to_string(),
            ),
            (
                "X-Cloudflare-Tunnel-Id".to_string(),
                "cf-tunnel-id-evil".to_string(),
            ),
            (
                "X-Matrix-Access-Token".to_string(),
                "matrix-token-evil".to_string(),
            ),
            (
                "x-matrix-server-name".to_string(),
                "evil-matrix.example".to_string(),
            ),
            ("x-discord-token".to_string(), "discord-token-evil".to_string()),
            (
                "x-discord-application-id".to_string(),
                "123456789012345678".to_string(),
            ),
            (
                "X-Signature-Ed25519".to_string(),
                "deadbeefsignature".to_string(),
            ),
            ("x-signature-timestamp".to_string(), "1711111111".to_string()),
            (
                "x-gitlab-webhook-token".to_string(),
                "gitlab-webhook-token-evil".to_string(),
            ),
            ("X-Gitea-Signature".to_string(), "gitea-signature-evil".to_string()),
            (
                "x-gitea-delivery".to_string(),
                "gitea-delivery-evil".to_string(),
            ),
            ("x-gogs-signature".to_string(), "gogs-signature-evil".to_string()),
            ("x-gogs-delivery".to_string(), "gogs-delivery-evil".to_string()),
            (
                "X-Slack-Signature".to_string(),
                "v0=deadbeef".to_string(),
            ),
            (
                "x-slack-request-timestamp".to_string(),
                "1711111111".to_string(),
            ),
            ("x-request-timestamp".to_string(), "1711111111".to_string()),
            ("x-slack-team-id".to_string(), "T01234567".to_string()),
            ("X-Hub-Signature".to_string(), "sha1=deadbeef".to_string()),
            (
                "x-hub-signature-256".to_string(),
                "sha256=deadbeef".to_string(),
            ),
            (
                "x-webhook-secret".to_string(),
                "custom-webhook-secret-evil".to_string(),
            ),
            (
                "X-Stripe-Signature".to_string(),
                "t=1711111111,v1=deadbeef".to_string(),
            ),
            (
                "x-stripe-account".to_string(),
                "acct_evil".to_string(),
            ),
            (
                "x-twilio-signature".to_string(),
                "twilio-signature-evil".to_string(),
            ),
            (
                "x-twilio-webhook-id".to_string(),
                "twilio-webhook-evil".to_string(),
            ),
            (
                "x-signal-signature".to_string(),
                "signal-signature-evil".to_string(),
            ),
            ("X-Line-Signature".to_string(), "line-signature-evil".to_string()),
            (
                "x-line-channel-id".to_string(),
                "line-channel-id-evil".to_string(),
            ),
            (
                "x-shopify-hmac-sha256".to_string(),
                "shopify-hmac-evil".to_string(),
            ),
            (
                "x-shopify-topic".to_string(),
                "orders/create".to_string(),
            ),
        ];
        let out = sanitized_plugin_headers(&headers);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].0, "content-type");
    }

    #[test]
    fn sanitized_headers_drop_vault_and_k8s_auth_headers() {
        let headers = vec![
            ("content-type".to_string(), "application/json".to_string()),
            ("x-vault-token".to_string(), "hvs.eviltoken".to_string()),
            ("X-K8S-AWS-ID".to_string(), "cluster-evil".to_string()),
            (
                "x-k8s-cluster-name".to_string(),
                "cluster-evil-2".to_string(),
            ),
        ];
        let out = sanitized_plugin_headers(&headers);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].0, "content-type");
    }

    #[test]
    fn sanitized_headers_drop_connection_string_headers() {
        let headers = vec![
            ("content-type".to_string(), "application/json".to_string()),
            (
                "x-database-url".to_string(),
                "postgres://user:pass@db/evil".to_string(),
            ),
            (
                "x-databaseurl".to_string(),
                "postgres://user:pass@db/evil".to_string(),
            ),
            (
                "x-dsn-primary".to_string(),
                "postgres://user:pass@db-primary/evil".to_string(),
            ),
            (
                "x-databasedsn".to_string(),
                "postgres://user:pass@db-primary/evil".to_string(),
            ),
            ("x-database-host".to_string(), "db.evil".to_string()),
            (
                "X-Redis-Url".to_string(),
                "redis://:pass@redis:6379/0".to_string(),
            ),
            (
                "X-RedisUrl".to_string(),
                "redis://:pass@redis:6379/0".to_string(),
            ),
            ("x-redis-host".to_string(), "redis.evil".to_string()),
            (
                "x-mongodb-uri".to_string(),
                "mongodb://user:pass@mongo:27017/evil".to_string(),
            ),
            (
                "x-mongodburi".to_string(),
                "mongodb://user:pass@mongo:27017/evil".to_string(),
            ),
            (
                "x-mongodb-dbname".to_string(),
                "evil".to_string(),
            ),
            (
                "X-Postgres-Url".to_string(),
                "postgres://user:pass@db/evil".to_string(),
            ),
            (
                "X-PostgresUrl".to_string(),
                "postgres://user:pass@db/evil".to_string(),
            ),
            (
                "x-postgres-user".to_string(),
                "postgres-evil".to_string(),
            ),
            ("x-mysql-url".to_string(), "mysql://user:pass@db/evil".to_string()),
            ("x-mysqlurl".to_string(), "mysql://user:pass@db/evil".to_string()),
            (
                "x-mysql-database".to_string(),
                "evil".to_string(),
            ),
            ("X-Broker-Url".to_string(), "amqp://user:pass@mq/evil".to_string()),
            ("x-broker-host".to_string(), "mq.evil".to_string()),
            ("x-amqp-url".to_string(), "amqp://user:pass@mq/evil".to_string()),
            ("x-amqp-host".to_string(), "mq.evil".to_string()),
            (
                "x-kafka-brokers".to_string(),
                "kafka-1.evil:9092".to_string(),
            ),
            ("x-nats-url".to_string(), "nats://nats.evil:4222".to_string()),
            (
                "x-rabbitmq-uri".to_string(),
                "amqp://rabbit.evil".to_string(),
            ),
            (
                "x-redpanda-brokers".to_string(),
                "redpanda.evil:9092".to_string(),
            ),
            ("X-Sqlite-Url".to_string(), "file:/tmp/evil.sqlite".to_string()),
            (
                "x-sqlite-busy-timeout".to_string(),
                "5000".to_string(),
            ),
            ("x-sqlite-path".to_string(), "/tmp/evil.sqlite".to_string()),
            ("X-Sqlite-File".to_string(), "/tmp/evil.sqlite".to_string()),
            (
                "x-sqlite-tmpdir".to_string(),
                "/tmp/evil-sqlite-tmp".to_string(),
            ),
            (
                "X-Sqlite-History".to_string(),
                "/tmp/evil-sqlite-history".to_string(),
            ),
            ("x-sqlcipher-key".to_string(), "sqlcipher-key-evil".to_string()),
            (
                "X-Sqlcipher-Passphrase".to_string(),
                "sqlcipher-pass-evil".to_string(),
            ),
            (
                "X-Libsql-Auth-Token".to_string(),
                "libsql-token-evil".to_string(),
            ),
            (
                "x-libsql-url".to_string(),
                "libsql://org.turso.io".to_string(),
            ),
            (
                "x-neon-branch-id".to_string(),
                "neon-branch-evil".to_string(),
            ),
            (
                "x-planetscale-org".to_string(),
                "pscale-org-evil".to_string(),
            ),
            (
                "x-upstash-account-id".to_string(),
                "upstash-account-evil".to_string(),
            ),
            ("x-turso-auth-token".to_string(), "turso-token-evil".to_string()),
            ("x-supabasedburl".to_string(), "postgres://user:pass@db/supabase".to_string()),
            (
                "x-metabasedbconnectionuri".to_string(),
                "postgres://user:pass@db/metabase".to_string(),
            ),
            ("x-mbdbconnectionuri".to_string(), "sqlite:///tmp/metabase.db".to_string()),
            ("X-Turso-Org".to_string(), "org-evil".to_string()),
            ("x-pglite-data-dir".to_string(), "/tmp/evil-pglite".to_string()),
            (
                "X-Pglite-Db-Path".to_string(),
                "/tmp/evil-pglite/db".to_string(),
            ),
            (
                "x-pglite-opfs-path".to_string(),
                "opfs://evil-db".to_string(),
            ),
            (
                "X-Pglite-Wal-Dir".to_string(),
                "/tmp/evil-pglite/wal".to_string(),
            ),
            ("X-Opfs-Path".to_string(), "opfs://evil-path".to_string()),
            ("x-opfs-root".to_string(), "opfs://evil-root".to_string()),
            (
                "X-Opfs-Snapshot-Path".to_string(),
                "opfs://evil-snapshot".to_string(),
            ),
        ];
        let out = sanitized_plugin_headers(&headers);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].0, "content-type");
    }

