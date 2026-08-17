<?php
@ini_set('display_errors', 0);
@ini_set('zlib.output_compression', 'Off');
@ini_set('output_buffering', 'Off');
while (ob_get_level()) {
    ob_end_clean();
}

header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET, OPTIONS");
header("Access-Control-Allow-Headers: *");

if (!isset($_GET['d']) || empty($_GET['d'])) {
    http_response_code(400);
    echo "Error: Missing destination URL";
    exit;
}

$targetUrl = $_GET['d'];
$referer = isset($_GET['ref']) ? $_GET['ref'] : 'https://kidntv.com/';

$cookieFile = sys_get_temp_dir() . '/cookie_hls_' . md5($referer . parse_url($targetUrl, PHP_URL_HOST)) . '.txt';

$headers = [
    "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Referer: " . $referer,
    "Accept: */*",
    "Accept-Language: ar,en-US;q=0.9,en;q=0.8"
];

if (isset($_SERVER['HTTP_RANGE'])) {
    $headers[] = "Range: " . $_SERVER['HTTP_RANGE'];
}

$ch = curl_init();
curl_setopt($ch, CURLOPT_URL, $targetUrl);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
curl_setopt($ch, CURLOPT_SSL_VERIFYHOST, false);
curl_setopt($ch, CURLOPT_COOKIEJAR, $cookieFile);
curl_setopt($ch, CURLOPT_COOKIEFILE, $cookieFile);
curl_setopt($ch, CURLOPT_HEADER, true);
curl_setopt($ch, CURLOPT_TIMEOUT, 30);

$response = curl_exec($ch);
$headerSize = curl_getinfo($ch, CURLINFO_HEADER_SIZE);
$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$contentType = curl_getinfo($ch, CURLINFO_CONTENT_TYPE);

$headerText = substr($response, 0, $headerSize);
$body = substr($response, $headerSize);
curl_close($ch);

if ($httpCode !== 200 && $httpCode !== 206) {
    http_response_code($httpCode ? $httpCode : 500);
    echo "Proxy Error: Failed to fetch target resource.";
    exit;
}

http_response_code($httpCode);

$isM3u8 = (strpos($body, '#EXTM3U') !== false || substr($targetUrl, -5) === '.m3u8' || strpos($contentType, 'mpegurl') !== false);

if ($isM3u8) {
    // ترويسات حيوية جداً لمنع التخزين المؤقت (Cache) للبث المباشر
    header("Content-Type: application/vnd.apple.mpegurl");
    header("Cache-Control: no-cache, no-store, must-revalidate, max-age=0");
    header("Pragma: no-cache");
    header("Expires: 0");
    
    $parsedUrl = parse_url($targetUrl);
    $baseUrl = $parsedUrl['scheme'] . '://' . $parsedUrl['host'] . (isset($parsedUrl['port']) ? ':' . $parsedUrl['port'] : '');
    $pathDir = dirname($parsedUrl['path'] ?? '') . '/';
    $absoluteBasePath = $baseUrl . $pathDir;

    $proxyBase = "https://" . $_SERVER['HTTP_HOST'] . $_SERVER['PHP_SELF'];

    $lines = explode("\n", $body);
    $output = "";

    foreach ($lines as $line) {
        $line = trim($line);
        if (empty($line)) continue;

        if (strpos($line, '#') === 0) {
            if (strpos($line, 'URI="') !== false) {
                $line = preg_replace_callback('/URI="([^"]+)"/', function($matches) use ($absoluteBasePath, $proxyBase, $referer, $parsedUrl) {
                    $keyUrl = $matches[1];
                    if (strpos($keyUrl, 'http') !== 0) {
                        $keyUrl = (strpos($keyUrl, '/') === 0) ? ($parsedUrl['scheme'] . '://' . $parsedUrl['host'] . $keyUrl) : ($absoluteBasePath . $keyUrl);
                    }
                    return 'URI="' . $proxyBase . '?d=' . urlencode($keyUrl) . '&ref=' . urlencode($referer) . '"';
                }, $line);
            }
            $output .= $line . "\n";
        } else {
            $segmentUrl = $line;
            if (strpos($segmentUrl, 'http') !== 0) {
                if (strpos($segmentUrl, '/') === 0) {
                    $segmentUrl = $parsedUrl['scheme'] . '://' . $parsedUrl['host'] . $segmentUrl;
                } else {
                    $segmentUrl = $absoluteBasePath . $segmentUrl;
                }
            }
            
            $proxiedSegment = $proxyBase . '?d=' . urlencode($segmentUrl) . '&ref=' . urlencode($referer);
            $output .= $proxiedSegment . "\n";
        }
    }
    echo $output;
} else {
    header("Content-Type: application/octet-stream");

    foreach (explode("\r\n", $headerText) as $h) {
        if (stripos($h, 'Content-Range:') === 0 || stripos($h, 'Accept-Ranges:') === 0 || stripos($h, 'Content-Length:') === 0) {
            header($h);
        }
    }

    echo $body;
}
exit;
?>
