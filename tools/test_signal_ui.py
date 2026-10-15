"""Real browser Signal layout/validation; no Android, model or physical audio claim."""
from playwright.sync_api import expect
from browser_support import OUT, served_browser

with served_browser(extra_args=['--mute-audio', '--disable-gpu']) as (server, browser):
    page = browser.new_page(viewport={'width': 1280, 'height': 900})
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    # Use the test-owned server, never an existing user session.
    page.goto(server.origin + '/signal.html')
    expect(page.locator('#lane-0')).to_have_attribute('data-self', 'true')
    expect(page.locator('.chat-empty')).to_contain_text('受信した言葉')
    expect(page.locator('#next-step')).to_contain_text('Bで受信を開始')
    page.locator('#topic').fill('  ')
    page.locator('#listen').click()
    expect(page.locator('#error')).to_contain_text('話題を入力')
    expect(page.locator('#listen')).to_be_enabled()
    expect(page.locator('#role')).to_be_enabled()
    page.locator('#topic').fill('音楽の話')
    page.locator('#listen').click()
    expect(page.locator('#error')).to_contain_text('Androidアプリ')
    expect(page.locator('#stop')).to_be_disabled()
    expect(page.locator('#start')).to_be_disabled()
    page.locator('#role').select_option('1')
    assert page.locator('#lane-1').get_attribute('data-self') == 'true'
    page.locator('.connection-help summary').click()
    expect(page.locator('.connection-help')).to_contain_text('18790')
    for width, height in [(360, 800), (412, 915), (1280, 900)]:
        page.set_viewport_size({'width': width, 'height': height})
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), width
        assert page.locator('#listen').bounding_box()['height'] >= 44
        assert page.locator('#start').is_visible()
        page.screenshot(path=str(OUT / f'signal-ui-{width}.png'), full_page=True)
    assert not errors, errors
    print('PASS Signal: actual modules/styles, empty topic, unsupported browser guidance, retry, role, help, 3 widths; no physical audio')
