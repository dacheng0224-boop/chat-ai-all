#!/usr/bin/env ruby
# frozen_string_literal: true

# 本地启动：提供网页 + 转发 API（Ruby 版，无需 Python）
# 用法：ruby serve.rb

require "json"
require "net/http"
require "uri"
require "webrick"
require "thread"

PORT = Integer(ENV.fetch("PORT", "8080"))
ROOT = File.expand_path(__dir__)

MIME_TYPES = {
  ".html" => "text/html; charset=utf-8",
  ".js" => "application/javascript; charset=utf-8",
  ".css" => "text/css; charset=utf-8",
  ".json" => "application/json; charset=utf-8",
  ".png" => "image/png",
  ".jpg" => "image/jpeg",
  ".svg" => "image/svg+xml",
  ".ico" => "image/x-icon"
}.freeze

def mime_for(path)
  MIME_TYPES[File.extname(path).downcase] || "application/octet-stream"
end

class ChatServlet < WEBrick::HTTPServlet::AbstractServlet
  def do_OPTIONS(_req, res)
    res.status = 204
    set_cors(res)
  end

  def do_GET(req, res)
    path = req.path
    path = "/index.html" if path == "/" || path.empty?

    file = File.join(ROOT, path.sub(%r{\A/}, ""))
    unless file.start_with?(ROOT + File::SEPARATOR) && File.file?(file)
      res.status = 404
      res["Content-Type"] = "text/plain"
      res.body = "Not Found"
      set_cors(res)
      return
    end

    res.status = 200
    res["Content-Type"] = mime_for(file)
    res.body = File.binread(file)
    set_cors(res)
  end

  def do_POST(req, res)
    path = req.path.split("?", 2).first
    if path.end_with?("/chat/completions") || path.start_with?("/api/chat/completions")
      proxy_to(req, res, "chat/completions")
    elsif path.end_with?("/images/generations") || path.start_with?("/api/images/generations")
      proxy_to(req, res, "images/generations")
    elsif path.end_with?("/images/edit") || path.start_with?("/api/images/edit")
      proxy_to(req, res, "images/edit")
    else
      res.status = 404
      res["Content-Type"] = "text/plain"
      res.body = "Not Found"
      set_cors(res)
    end
  end

  private

  def set_cors(res)
    res["Access-Control-Allow-Origin"] = "*"
    res["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    res["Access-Control-Allow-Headers"] = "Content-Type, Authorization, X-Target-Base-Url"
  end

  def json_error(res, code, message)
    payload = { error: { message: message } }.to_json
    res.status = code
    res["Content-Type"] = "application/json; charset=utf-8"
    res.body = payload
    set_cors(res)
  end

  def proxy_to(req, res, upstream_path)
    target_base = (req["X-Target-Base-Url"] || "").strip.sub(%r{/+\z}, "")
    if target_base.empty?
      json_error(res, 400, "缺少请求头 X-Target-Base-Url，请在设置中填写 Base URL")
      return
    end

    upstream = URI.join("#{target_base}/", upstream_path)
    http = Net::HTTP.new(upstream.host, upstream.port)
    http.use_ssl = upstream.scheme == "https"
    http.read_timeout = 600
    http.open_timeout = 30

    proxy_req = Net::HTTP::Post.new(upstream.request_uri)
    proxy_req["Content-Type"] = req["Content-Type"] if req["Content-Type"]
    proxy_req["Authorization"] = req["Authorization"] if req["Authorization"]
    proxy_req.body = req.body

    begin
      upstream_res = http.request(proxy_req)
      res.status = upstream_res.code.to_i
      upstream_res.each_header do |key, val|
        next if %w[connection transfer-encoding content-encoding].include?(key.downcase)

        res[key] = val
      end
      res.body = upstream_res.body
      set_cors(res)
    rescue StandardError => e
      json_error(res, 502, "无法连接中转站：#{e.message}")
    end
  end
end

server = WEBrick::HTTPServer.new(
  BindAddress: "127.0.0.1",
  Port: PORT,
  DocumentRoot: ROOT,
  Logger: WEBrick::Log.new($stderr, WEBrick::Log::INFO),
  AccessLog: [[$stderr, WEBrick::AccessLog::COMBINED_LOG_FORMAT]]
)
server.mount("/", ChatServlet)

url = "http://127.0.0.1:#{PORT}/"
puts "Chat 已启动: #{url}"
puts "按 Ctrl+C 停止"

Thread.new do
  sleep 0.8
  system("open", url)
end

trap("INT") { puts "\n已停止"; server.shutdown }

server.start
