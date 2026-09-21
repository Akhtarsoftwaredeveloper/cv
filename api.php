<?php
/**
 * api.php: the small server-side program behind the Admin Panel.
 *
 * It does five jobs:
 *   1. checks the admin login (username + password, kept safely hashed)
 *   2. saves the website content to data/site.json
 *   3. stores uploaded images in the uploads folder
 *   4. stores messages sent from the Contact page
 *   5. reports whether the folders are ready (Setup check)
 *
 * You never need to edit this file.
 * Needs: any normal web hosting with PHP 7 or newer.
 */

error_reporting(E_ALL);
ini_set('display_errors', '0');
ini_set('log_errors', '1');

define('ROOT', __DIR__);
define('DATA_FILE', ROOT . '/data/site.json');
define('PRIV_DIR', ROOT . '/private');
define('UPLOAD_DIR', ROOT . '/uploads');
define('DEFAULT_USER', 'admin');
define('DEFAULT_PASS', 'Admin123');
define('THEMES', 'charcoal-orange,midnight-blue,slate-purple,emerald-dark');
define('MAX_UPLOAD', 6 * 1024 * 1024);

/* ------------------------------------------------------------------ output */

function out($arr, $code = 200) {
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store, no-cache, must-revalidate');
    header('X-Content-Type-Options: nosniff');
    echo json_encode($arr, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function fail($msg, $code = 400) {
    out(array('ok' => false, 'error' => $msg), $code);
}

set_exception_handler(function ($e) {
    error_log('api.php: ' . $e->getMessage());
    fail('Something went wrong on the server. Please try again.', 500);
});

/* ---------------------------------------------------------------- helpers */

function idx($arr, $key, $default = '') {
    return (is_array($arr) && isset($arr[$key])) ? $arr[$key] : $default;
}

function token() {
    if (function_exists('random_bytes')) {
        return bin2hex(random_bytes(16));
    }
    return md5(uniqid((string)mt_rand(), true)) . md5(uniqid((string)mt_rand(), true));
}

function body_json() {
    $raw = file_get_contents('php://input');
    if ($raw === false) {
        return array();
    }
    if (strlen($raw) > 2 * 1024 * 1024) {
        fail('That request was too large.', 413);
    }
    $j = json_decode($raw, true);
    return is_array($j) ? $j : array();
}

function atomic_write($file, $content) {
    $tmp = $file . '.tmp' . mt_rand(1000, 9999);
    if (file_put_contents($tmp, $content, LOCK_EX) === false) {
        return false;
    }
    if (!@rename($tmp, $file)) {
        $ok = @copy($tmp, $file);
        @unlink($tmp);
        return $ok;
    }
    return true;
}

function client_ip() {
    return isset($_SERVER['REMOTE_ADDR']) ? (string)$_SERVER['REMOTE_ADDR'] : 'unknown';
}

/* --------------------------------------- private files (never web-readable) */
/* They are saved as .php files that stop immediately when opened in a browser. */

function priv_path($name) {
    return PRIV_DIR . '/' . $name . '.php';
}

function priv_read($name) {
    $f = priv_path($name);
    if (!is_file($f)) {
        return null;
    }
    $raw = file_get_contents($f);
    if ($raw === false) {
        return null;
    }
    $pos = strpos($raw, "\n");
    if ($pos === false) {
        return null;
    }
    $j = json_decode(substr($raw, $pos + 1), true);
    return is_array($j) ? $j : null;
}

function priv_write($name, $arr) {
    if (!is_dir(PRIV_DIR)) {
        @mkdir(PRIV_DIR, 0755, true);
    }
    $guard = '<' . '?php http_response_code(404); exit; ?' . ">\n";
    $body = $guard . json_encode($arr, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    return atomic_write(priv_path($name), $body);
}

/* ------------------------------------------------------------------ session */

function start_session() {
    if (session_status() === PHP_SESSION_ACTIVE) {
        return;
    }
    $https = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
        || (isset($_SERVER['HTTP_X_FORWARDED_PROTO']) && $_SERVER['HTTP_X_FORWARDED_PROTO'] === 'https');
    @ini_set('session.use_strict_mode', '1');
    @ini_set('session.cookie_samesite', 'Lax');
    session_name('am_admin');
    session_set_cookie_params(0, '/', '', $https, true);
    @session_start();
    if (session_status() !== PHP_SESSION_ACTIVE) {
        fail('Login sessions are not available on this hosting. Please ask your hosting support to enable PHP sessions.', 500);
    }
    if (isset($_SESSION['last']) && (time() - $_SESSION['last']) > 7200) {
        $_SESSION = array();
    }
    $_SESSION['last'] = time();
}

function require_admin($csrf = true) {
    if (empty($_SESSION['auth'])) {
        fail('Please log in again.', 401);
    }
    if ($csrf) {
        $sent = isset($_SERVER['HTTP_X_CSRF_TOKEN']) ? (string)$_SERVER['HTTP_X_CSRF_TOKEN'] : '';
        if (!isset($_SESSION['csrf']) || !hash_equals((string)$_SESSION['csrf'], $sent)) {
            fail('Your session has expired. Please reload the page and log in again.', 403);
        }
    }
}

function auth_load() {
    $a = priv_read('auth');
    if (!$a || empty($a['hash'])) {
        $a = array(
            'user' => DEFAULT_USER,
            'hash' => password_hash(DEFAULT_PASS, PASSWORD_DEFAULT),
            'must_change' => true
        );
        if (!priv_write('auth', $a)) {
            fail('The "private" folder is not writable. Please see the hosting guide (Setup check).', 500);
        }
    }
    return $a;
}

/* ------------------------------------------------ rate limiting (per visitor) */

function rl_hits($all, $bucket, $window) {
    $ip = client_ip();
    $now = time();
    $hits = (isset($all[$bucket]) && isset($all[$bucket][$ip])) ? $all[$bucket][$ip] : array();
    $keep = array();
    foreach ($hits as $t) {
        if ($t > $now - $window) {
            $keep[] = $t;
        }
    }
    return $keep;
}

function rl_count($bucket, $window) {
    $all = priv_read('ratelimit');
    if (!is_array($all)) {
        $all = array();
    }
    return count(rl_hits($all, $bucket, $window));
}

function rl_add($bucket, $window) {
    $all = priv_read('ratelimit');
    if (!is_array($all)) {
        $all = array();
    }
    $hits = rl_hits($all, $bucket, $window);
    $hits[] = time();
    $all[$bucket][client_ip()] = $hits;
    $now = time();
    foreach ($all as $b => $ips) {
        foreach ($ips as $ip => $list) {
            $fresh = false;
            foreach ($list as $t) {
                if ($t > $now - 7200) {
                    $fresh = true;
                }
            }
            if (!$fresh) {
                unset($all[$b][$ip]);
            }
        }
    }
    priv_write('ratelimit', $all);
}

function rl_clear($bucket) {
    $all = priv_read('ratelimit');
    if (is_array($all) && isset($all[$bucket][client_ip()])) {
        unset($all[$bucket][client_ip()]);
        priv_write('ratelimit', $all);
    }
}

/* --------------------------------------------------------------- cleaning */

function s($v, $max) {
    if (!is_string($v) && !is_numeric($v)) {
        return '';
    }
    $v = trim((string)$v);
    if (function_exists('mb_substr')) {
        $v = mb_substr($v, 0, $max, 'UTF-8');
    } else {
        $v = substr($v, 0, $max);
    }
    return preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F]/', '', $v);
}

function clean_id($v, $fallback) {
    $v = strtolower(preg_replace('/[^a-z0-9]+/i', '-', (string)$v));
    $v = trim($v, '-');
    return $v !== '' ? substr($v, 0, 60) : $fallback;
}

function uniq_id($id, &$seen) {
    $base = $id;
    $n = 2;
    while (isset($seen[$id])) {
        $id = $base . '-' . $n;
        $n++;
    }
    $seen[$id] = true;
    return $id;
}

function clean_path($v) {
    $v = trim((string)$v);
    if ($v === '') {
        return '';
    }
    if (preg_match('#^(uploads|assets)/[A-Za-z0-9_\-./]+$#', $v) && strpos($v, '..') === false) {
        return $v;
    }
    return '';
}

function clean_url($v) {
    $v = trim((string)$v);
    if ($v === '') {
        return '';
    }
    if (!preg_match('#^https?://#i', $v)) {
        $v = 'https://' . $v;
    }
    if (strlen($v) > 300 || !filter_var($v, FILTER_VALIDATE_URL)) {
        return '';
    }
    return $v;
}

function clean_email($v) {
    $v = trim((string)$v);
    if ($v === '' || strlen($v) > 150) {
        return '';
    }
    return filter_var($v, FILTER_VALIDATE_EMAIL) ? $v : '';
}

function clean_phone($v) {
    $v = preg_replace('/[^0-9+ ()\-]/', '', (string)$v);
    if (strlen(preg_replace('/\D/', '', $v)) < 6) {
        return '';
    }
    return substr($v, 0, 25);
}

function list_of($in, $key, $max) {
    $list = idx($in, $key, array());
    if (!is_array($list)) {
        return array();
    }
    $out = array();
    foreach ($list as $item) {
        if (is_array($item)) {
            $out[] = $item;
        }
        if (count($out) >= $max) {
            break;
        }
    }
    return $out;
}

/* Builds a clean, safe copy of the website data. Anything unexpected is dropped. */
function sanitize_site($in) {
    $themes = explode(',', THEMES);
    $icons = array('web', 'school', 'apps', 'training', 'ai', 'excel', 'support', 'design', 'database', 'mobile', 'shield', 'chart');
    $out = array('version' => 1);

    $theme = idx($in, 'theme', '');
    $out['theme'] = in_array($theme, $themes, true) ? $theme : $themes[0];

    $text = array();
    $tin = idx($in, 'text', array());
    if (is_array($tin)) {
        $n = 0;
        foreach ($tin as $k => $v) {
            if ($n++ > 800) {
                break;
            }
            if (!preg_match('/^[a-z0-9._\-]{1,80}$/', (string)$k)) {
                continue;
            }
            $text[(string)$k] = s($v, 2000);
        }
    }
    $out['text'] = $text ? $text : new stdClass();

    $img = idx($in, 'images', array());
    $out['images'] = array(
        'logo' => clean_path(idx($img, 'logo')),
        'profile' => clean_path(idx($img, 'profile')),
        'about' => clean_path(idx($img, 'about'))
    );

    $con = idx($in, 'contact', array());
    $out['contact'] = array(
        'email' => clean_email(idx($con, 'email')),
        'whatsapp' => clean_phone(idx($con, 'whatsapp'))
    );

    $soc = idx($in, 'social', array());
    $out['social'] = array();
    foreach (array('github', 'linkedin', 'facebook', 'youtube', 'instagram') as $k) {
        $out['social'][$k] = clean_url(idx($soc, $k));
    }

    $seen = array();
    $out['services'] = array();
    foreach (list_of($in, 'services', 60) as $i => $x) {
        $title = s(idx($x, 'title'), 120);
        if ($title === '') {
            continue;
        }
        $icon = idx($x, 'icon');
        $out['services'][] = array(
            'id' => uniq_id(clean_id(idx($x, 'id'), 'svc-' . ($i + 1)), $seen),
            'title' => $title,
            'description' => s(idx($x, 'description'), 400),
            'icon' => in_array($icon, $icons, true) ? $icon : 'web',
            'price' => s(idx($x, 'price'), 60)
        );
    }

    $seen = array();
    $out['categories'] = array();
    $catIds = array();
    foreach (list_of($in, 'categories', 30) as $i => $x) {
        $name = s(idx($x, 'name'), 60);
        if ($name === '') {
            continue;
        }
        $id = uniq_id(clean_id(idx($x, 'id', $name), 'cat-' . ($i + 1)), $seen);
        $catIds[$id] = true;
        $out['categories'][] = array('id' => $id, 'name' => $name);
    }

    $seen = array();
    $out['projects'] = array();
    foreach (list_of($in, 'projects', 100) as $i => $x) {
        $title = s(idx($x, 'title'), 150);
        if ($title === '') {
            continue;
        }
        $cat = (string)idx($x, 'category');
        $art = (int)idx($x, 'art', 0);
        $out['projects'][] = array(
            'id' => uniq_id(clean_id(idx($x, 'id', $title), 'project-' . ($i + 1)), $seen),
            'title' => $title,
            'description' => s(idx($x, 'description'), 300),
            'details' => s(idx($x, 'details'), 3000),
            'category' => isset($catIds[$cat]) ? $cat : '',
            'image' => clean_path(idx($x, 'image')),
            'featured' => !empty($x['featured']),
            'art' => ($art >= 1 && $art <= 6) ? $art : 0
        );
    }

    $seen = array();
    $out['awards'] = array();
    foreach (list_of($in, 'awards', 60) as $i => $x) {
        $title = s(idx($x, 'title'), 150);
        if ($title === '') {
            continue;
        }
        $out['awards'][] = array(
            'id' => uniq_id(clean_id(idx($x, 'id'), 'award-' . ($i + 1)), $seen),
            'title' => $title,
            'issuer' => s(idx($x, 'issuer'), 150),
            'year' => s(idx($x, 'year'), 20),
            'description' => s(idx($x, 'description'), 600),
            'image' => clean_path(idx($x, 'image'))
        );
    }

    $seen = array();
    $out['testimonials'] = array();
    foreach (list_of($in, 'testimonials', 40) as $i => $x) {
        $t = s(idx($x, 'text'), 800);
        $name = s(idx($x, 'name'), 100);
        if ($t === '' || $name === '') {
            continue;
        }
        $out['testimonials'][] = array(
            'id' => uniq_id(clean_id(idx($x, 'id'), 'testimonial-' . ($i + 1)), $seen),
            'text' => $t,
            'name' => $name,
            'role' => s(idx($x, 'role'), 120)
        );
    }

    $out['tools'] = array();
    $tools = idx($in, 'tools', array());
    if (is_array($tools)) {
        foreach ($tools as $t) {
            $t = s($t, 40);
            if ($t !== '') {
                $out['tools'][] = $t;
            }
            if (count($out['tools']) >= 60) {
                break;
            }
        }
    }

    $out['updated'] = time();
    return $out;
}

function site_json($site) {
    return json_encode($site, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
}

function site_load() {
    if (!is_file(DATA_FILE)) {
        return array();
    }
    $j = json_decode((string)file_get_contents(DATA_FILE), true);
    return is_array($j) ? $j : array();
}

function site_save($site) {
    if (!is_dir(dirname(DATA_FILE))) {
        @mkdir(dirname(DATA_FILE), 0755, true);
    }
    $json = site_json($site);
    if (!atomic_write(DATA_FILE, $json)) {
        fail('Could not save. The "data" folder is not writable. Please see the hosting guide (Setup check).', 500);
    }
    cleanup_uploads($json);
}

/* Removes uploaded images that are no longer used anywhere (older than 1 hour). */
function cleanup_uploads($json) {
    if (!is_dir(UPLOAD_DIR)) {
        return;
    }
    preg_match_all('#uploads/([A-Za-z0-9_\-.]+)#', $json, $m);
    $used = array_flip($m[1]);
    $files = @scandir(UPLOAD_DIR);
    if (!$files) {
        return;
    }
    foreach ($files as $f) {
        if ($f === '.' || $f === '..' || $f === '.htaccess' || $f === 'index.html') {
            continue;
        }
        $p = UPLOAD_DIR . '/' . $f;
        if (is_file($p) && !isset($used[$f]) && filemtime($p) < time() - 3600) {
            @unlink($p);
        }
    }
}

/* ---------------------------------------------------------------- actions */

function act_session() {
    if (!empty($_SESSION['auth'])) {
        $a = auth_load();
        out(array('ok' => true, 'loggedIn' => true, 'csrf' => $_SESSION['csrf'], 'user' => $a['user'], 'mustChange' => !empty($a['must_change'])));
    }
    out(array('ok' => true, 'loggedIn' => false));
}

function act_login() {
    $in = body_json();
    $user = (string)idx($in, 'username');
    $pass = (string)idx($in, 'password');
    if (rl_count('login', 900) >= 5) {
        fail('Too many failed attempts. Please wait 15 minutes and try again.', 429);
    }
    $auth = auth_load();
    $ok = hash_equals((string)$auth['user'], $user) && password_verify($pass, (string)$auth['hash']);
    if (!$ok) {
        rl_add('login', 900);
        usleep(600000);
        fail('Incorrect username or password.', 401);
    }
    rl_clear('login');
    session_regenerate_id(true);
    $_SESSION['auth'] = true;
    $_SESSION['user'] = $auth['user'];
    $_SESSION['csrf'] = token();
    out(array('ok' => true, 'csrf' => $_SESSION['csrf'], 'user' => $auth['user'], 'mustChange' => !empty($auth['must_change'])));
}

function act_logout() {
    $_SESSION = array();
    if (session_status() === PHP_SESSION_ACTIVE) {
        session_destroy();
    }
    out(array('ok' => true));
}

function act_save() {
    require_admin(true);
    $in = body_json();
    $site = sanitize_site(idx($in, 'data', array()));
    site_save($site);
    out(array('ok' => true, 'data' => $site));
}

function act_set_theme() {
    require_admin(true);
    $in = body_json();
    $theme = (string)idx($in, 'theme');
    if (!in_array($theme, explode(',', THEMES), true)) {
        fail('Unknown theme.');
    }
    $site = site_load();
    $site['theme'] = $theme;
    $clean = sanitize_site($site);
    site_save($clean);
    out(array('ok' => true, 'theme' => $theme));
}

function act_upload() {
    require_admin(true);
    if (!isset($_FILES['file']) || !is_array($_FILES['file'])) {
        fail('No image was received. It may be larger than your hosting allows.');
    }
    $f = $_FILES['file'];
    if ($f['error'] === UPLOAD_ERR_INI_SIZE || $f['error'] === UPLOAD_ERR_FORM_SIZE) {
        fail('This image is too large for your hosting. Please choose a smaller image.');
    }
    if ($f['error'] !== UPLOAD_ERR_OK) {
        fail('The image could not be uploaded. Please try again.');
    }
    if ($f['size'] > MAX_UPLOAD) {
        fail('This image is larger than 6 MB. Please choose a smaller image.');
    }
    $info = @getimagesize($f['tmp_name']);
    if (!$info) {
        fail('That file is not a valid image.');
    }
    $map = array(IMAGETYPE_JPEG => 'jpg', IMAGETYPE_PNG => 'png', IMAGETYPE_GIF => 'gif');
    if (defined('IMAGETYPE_WEBP')) {
        $map[IMAGETYPE_WEBP] = 'webp';
    }
    if (!isset($map[$info[2]])) {
        fail('Please upload a JPG, PNG, WebP or GIF image.');
    }
    if (!is_dir(UPLOAD_DIR)) {
        @mkdir(UPLOAD_DIR, 0755, true);
    }
    $name = 'img-' . date('Ymd-His') . '-' . substr(token(), 0, 8) . '.' . $map[$info[2]];
    $dest = UPLOAD_DIR . '/' . $name;
    if (!@move_uploaded_file($f['tmp_name'], $dest)) {
        fail('The image could not be saved. The "uploads" folder may not be writable.', 500);
    }
    @chmod($dest, 0644);
    out(array('ok' => true, 'path' => 'uploads/' . $name));
}

function act_change_password() {
    require_admin(true);
    $in = body_json();
    $auth = auth_load();
    $cur = (string)idx($in, 'current');
    $newUser = trim((string)idx($in, 'username'));
    $new = (string)idx($in, 'password');
    if (!password_verify($cur, (string)$auth['hash'])) {
        fail('Your current password is not correct.', 403);
    }
    if (!preg_match('/^[A-Za-z0-9_.@\-]{3,40}$/', $newUser)) {
        fail('The username must be 3 to 40 letters or numbers (no spaces).');
    }
    if (strlen($new) < 8) {
        fail('The new password must be at least 8 characters long.');
    }
    if ($new === DEFAULT_PASS || strtolower($new) === strtolower($newUser)) {
        fail('Please choose a different password. It must not be the default one.');
    }
    $auth = array('user' => $newUser, 'hash' => password_hash($new, PASSWORD_DEFAULT), 'must_change' => false);
    if (!priv_write('auth', $auth)) {
        fail('The password could not be saved. The "private" folder is not writable.', 500);
    }
    session_regenerate_id(true);
    $_SESSION['auth'] = true;
    $_SESSION['user'] = $newUser;
    $_SESSION['csrf'] = token();
    out(array('ok' => true, 'csrf' => $_SESSION['csrf'], 'user' => $newUser));
}

function act_messages() {
    require_admin(false);
    $m = priv_read('messages');
    if (!is_array($m)) {
        $m = array();
    }
    out(array('ok' => true, 'messages' => array_values($m)));
}

function act_message_update() {
    require_admin(true);
    $in = body_json();
    $id = (string)idx($in, 'id');
    $do = (string)idx($in, 'do');
    $m = priv_read('messages');
    if (!is_array($m)) {
        $m = array();
    }
    $next = array();
    foreach ($m as $row) {
        if (idx($row, 'id') === $id) {
            if ($do === 'delete') {
                continue;
            }
            if ($do === 'read') {
                $row['read'] = true;
            }
            if ($do === 'unread') {
                $row['read'] = false;
            }
        }
        $next[] = $row;
    }
    priv_write('messages', array_values($next));
    out(array('ok' => true));
}

function act_contact() {
    $in = body_json();
    if (trim((string)idx($in, 'website')) !== '') {
        out(array('ok' => true)); // hidden trap field: a robot filled it in
    }
    $name = s(idx($in, 'name'), 100);
    $email = clean_email(idx($in, 'email'));
    $msg = s(idx($in, 'message'), 3000);
    $svc = s(idx($in, 'service'), 120);
    if ($name === '' || $email === '' || strlen($msg) < 5) {
        fail('Please fill in your name, a valid email address and a message.');
    }
    if (rl_count('contact', 3600) >= 5) {
        fail('You have sent several messages already. Please try again later.', 429);
    }
    rl_add('contact', 3600);

    $m = priv_read('messages');
    if (!is_array($m)) {
        $m = array();
    }
    array_unshift($m, array(
        'id' => substr(token(), 0, 12),
        'name' => $name,
        'email' => $email,
        'message' => $msg,
        'service' => $svc,
        'time' => time(),
        'read' => false
    ));
    $m = array_slice($m, 0, 300);
    if (!priv_write('messages', $m)) {
        fail('Your message could not be saved. Please try again later.', 500);
    }

    // Best effort: also send it to the admin email if one is set (many hosts allow this).
    $site = site_load();
    $to = clean_email(idx(idx($site, 'contact', array()), 'email'));
    if ($to !== '' && function_exists('mail')) {
        $host = isset($_SERVER['HTTP_HOST']) ? preg_replace('/[^A-Za-z0-9.\-]/', '', (string)$_SERVER['HTTP_HOST']) : 'localhost';
        $body = "New message from your website\n\nName: " . $name . "\nEmail: " . $email . ($svc !== '' ? "\nService: " . $svc : '') . "\n\n" . $msg . "\n";
        $headers = 'From: website@' . $host . "\r\n" . 'Reply-To: ' . $email . "\r\n" . 'Content-Type: text/plain; charset=UTF-8';
        @mail($to, 'New message from your website', $body, $headers);
    }
    out(array('ok' => true));
}

function act_health() {
    require_admin(false);
    $dataDir = dirname(DATA_FILE);
    $dataOk = is_dir($dataDir) ? (is_writable($dataDir) && (!is_file(DATA_FILE) || is_writable(DATA_FILE))) : is_writable(ROOT);
    $upOk = is_dir(UPLOAD_DIR) ? is_writable(UPLOAD_DIR) : is_writable(ROOT);
    $privOk = is_dir(PRIV_DIR) ? is_writable(PRIV_DIR) : is_writable(ROOT);
    out(array(
        'ok' => true,
        'php' => PHP_VERSION,
        'dataWritable' => $dataOk,
        'uploadsWritable' => $upOk,
        'privateWritable' => $privOk,
        'maxUpload' => (string)ini_get('upload_max_filesize'),
        'postMax' => (string)ini_get('post_max_size')
    ));
}

/* ----------------------------------------------------------------- router */

$action = isset($_GET['action']) ? (string)$_GET['action'] : '';
$method = isset($_SERVER['REQUEST_METHOD']) ? $_SERVER['REQUEST_METHOD'] : 'GET';
if ($action !== 'contact') {
    start_session();
}
$postOnly = array('login', 'logout', 'save', 'set_theme', 'upload', 'change_password', 'message_update', 'contact');

if (in_array($action, $postOnly, true) && $method !== 'POST') {
    fail('Please use POST.', 405);
}

switch ($action) {
    case 'session':         act_session(); break;
    case 'login':           act_login(); break;
    case 'logout':          act_logout(); break;
    case 'save':            act_save(); break;
    case 'set_theme':       act_set_theme(); break;
    case 'upload':          act_upload(); break;
    case 'change_password': act_change_password(); break;
    case 'messages':        act_messages(); break;
    case 'message_update':  act_message_update(); break;
    case 'contact':         act_contact(); break;
    case 'health':          act_health(); break;
    default:                fail('Unknown request.', 404);
}
