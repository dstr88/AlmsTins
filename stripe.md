<?php
header("Content-Type: application/json");

// Load Stripe config
$cfg = require "/home3/titanium/stripe-config.php";

$secretKey = $cfg["STRIPE_SECRET_KEY"] ?? "";
$baseUrl   = $cfg["APP_BASE_URL"] ?? "https://titaniumhut.com";

if (!$secretKey) {
  http_response_code(500);
  echo json_encode(["error" => "Stripe secret missing"]);
  exit;
}

// Get POST data
$input = json_decode(file_get_contents("php://input"), true);

$domain = trim($input["domain"] ?? "");
$price  = intval($input["price"] ?? 0); // cents

if (!$domain || $price < 100) {
  http_response_code(400);
  echo json_encode(["error" => "Invalid domain or price"]);
  exit;
}

// Build Stripe request
$data = [
  "mode" => "payment",
  "success_url" => $baseUrl . "/success.html",
  "cancel_url"  => $baseUrl . "/cancel.html",
  "line_items[0][price_data][currency]" => "usd",
  "line_items[0][price_data][product_data][name]" => "Domain Registration: " . $domain,
  "line_items[0][price_data][unit_amount]" => $price,
  "line_items[0][quantity]" => 1,

  // Metadata passed to webhook
  "metadata[domain]" => $domain,
];

// Call Stripe
$ch = curl_init("https://api.stripe.com/v1/checkout/sessions");
curl_setopt_array($ch, [
  CURLOPT_RETURNTRANSFER => true,
  CURLOPT_POST => true,
  CURLOPT_POSTFIELDS => http_build_query($data),
  CURLOPT_HTTPHEADER => [
    "Authorization: Bearer " . $secretKey,
    "Content-Type: application/x-www-form-urlencoded"
  ]
]);

$response = curl_exec($ch);
$err = curl_error($ch);
$code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

if (!$response || $code !== 200) {
  http_response_code(500);
  echo json_encode([
    "error" => "Stripe request failed",
    "http" => $code,
    "curl" => $err
  ]);
  exit;
}

echo $response;


donnie@titaniumhut.com
public key pk_live_51KRNOtJKtCP7qYxTHJVjUV4ZOb2uXC5lYzMDi07s3dR7hrksubRmOnSTsLs4ZBJqKpAWtjZLkaoHGtBPlDj6BAC400eFO77nSl












<?php
header("Content-Type: application/json");

// Load Stripe config
$cfg = require "/home3/titanium/stripe-config.php";

$secretKey = $cfg["STRIPE_SECRET_KEY"] ?? "";
$baseUrl   = $cfg["APP_BASE_URL"] ?? "https://titaniumhut.com";

$mode = (strpos($secretKey, "sk_live_") === 0) ? "live" : "test";


if (!$secretKey) {
  http_response_code(500);
  echo json_encode(["error" => "Stripe secret missing"]);
  exit;
}

// Get POST data
$input = json_decode(file_get_contents("php://input"), true);

$domain = trim($input["domain"] ?? "");
$price  = intval($input["price"] ?? 0); // cents

if (!$domain || $price < 100) {
  http_response_code(400);
  echo json_encode(["error" => "Invalid domain or price"]);
  exit;
}

// Build Stripe request
$data = [
  "mode" => "payment",
  "success_url" => $baseUrl . "/success.html",
  "cancel_url"  => $baseUrl . "/cancel.html",
  "line_items[0][price_data][currency]" => "usd",
  "line_items[0][price_data][product_data][name]" => "Domain Registration: " . $domain,
  "line_items[0][price_data][unit_amount]" => $price,
  "line_items[0][quantity]" => 1,

  // Metadata passed to webhook
  "metadata[domain]" => $domain,
];

// Call Stripe
$ch = curl_init("https://api.stripe.com/v1/checkout/sessions");
curl_setopt_array($ch, [
  CURLOPT_RETURNTRANSFER => true,
  CURLOPT_POST => true,
  CURLOPT_POSTFIELDS => http_build_query($data),
  CURLOPT_HTTPHEADER => [
    "Authorization: Bearer " . $secretKey,
    "Content-Type: application/x-www-form-urlencoded"
  ]
]);

$response = curl_exec($ch);
$err = curl_error($ch);
$code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

if (!$response || $code !== 200) {
  http_response_code(500);
  echo json_encode([
    "error" => "Stripe request failed",
    "http" => $code,
    "curl" => $err
  ]);
  exit;
}

echo $response;


<?php
return [
  "STRIPE_SECRET_KEY" => "REPLACE_WITH_YOUR_STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET" => "REPLACE_WITH_YOUR_STRIPE_WEBHOOK_SECRET",
  "APP_BASE_URL" => "https://titaniumhut.com"

  password: REPLACE_WITH_YOUR_PASSWORD
];
