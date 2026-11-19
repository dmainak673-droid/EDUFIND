def test_health_matches_frontend_contract(api) -> None:
    response = api.client.get("/api/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "version": api.settings.app_version}

