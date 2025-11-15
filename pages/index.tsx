import { useState, useRef } from "react";
import html2canvas from "html2canvas";

type Result = {
  brand: string;
  category: string;
  returnWindow: string;
  refundType: string;
  returnMethod: string;
  costs: string;
  conditions: string[];
  riskScore: string;
  riskLevel: "green" | "yellow" | "red";
  benchmark: string;
  tip: string;
};

export default function Home() {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<Result | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);

  // Helper: normalize URL and get domain
  const normalizeUrl = (raw: string) => {
    let u = raw.trim();
    if (!u.startsWith("http://") && !u.startsWith("https://")) {
      u = "https://" + u;
    }
    return new URL(u);
  };

  // Client-side scraping using public CORS proxy (AllOrigins)
  const fetchPolicyText = async (cleanUrl: URL): Promise<string> => {
    const target = cleanUrl.toString();
    const proxyUrl =
      "https://api.allorigins.win/raw?url=" + encodeURIComponent(target);

    const res = await fetch(proxyUrl);
    if (!res.ok) {
      throw new Error(`Failed to fetch page HTML (status ${res.status})`);
    }
    const html = await res.text();

    // Parse HTML in browser and extract text
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");
    ["script", "style", "noscript"].forEach((tag) => {
      doc.querySelectorAll(tag).forEach((el) => el.remove());
    });

    const body = doc.body;
    let text = body ? body.textContent || "" : "";
    text = text.replace(/\s+/g, " ").trim();

    return text;
  };

  const analyze = async () => {
    setError(null);
    setData(null);

    if (!url.trim()) {
      setError("Please paste a product or policy page URL.");
      return;
    }

    setLoading(true);
    try {
      const cleanUrl = normalizeUrl(url);
      const domain = cleanUrl.hostname;

      // 1) Get HTML + text in browser
      const fullText = await fetchPolicyText(cleanUrl);

      // 2) Send text to backend for GPT summary
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          policyText: fullText,
          domain,
        }),
      });

      let json: any;
      try {
        json = await res.json();
      } catch {
        throw new Error(`Server error (status ${res.status}) – invalid JSON.`);
      }

      if (!res.ok) {
        throw new Error(json.error || `Server returned ${res.status}`);
      }

      setData(json);
    } catch (e: any) {
      console.error(e);
      setError(e.message || "Something went wrong while analyzing.");
    } finally {
      setLoading(false);
    }
  };

  const downloadCard = async () => {
    if (!cardRef.current) return;
    const canvas = await html2canvas(cardRef.current, {
      backgroundColor: "#020617",
      scale: 2,
    });
    const link = document.createElement("a");
    link.download = "valetpe-return-summary.png";
    link.href = canvas.toDataURL("image/png");
    link.click();
  };

  return (
    <div className="page">
      <div className="container">
        <div className="card">
          <div className="logo-row">
            <img src="/valetpe-logo.png" alt="ValetPe" />
            <span className="badge">Return Policy Decoder · India</span>
          </div>

          <h1>Decode Any Return Policy in Seconds</h1>
          <p className="card-subtitle">
            Paste any product or policy link. We&apos;ll read the page in your
            browser and show a simple risk summary.
          </p>

          <div className="input-row">
            <input
              className="input-url"
              value={url}
              placeholder="https://www.wearcomet.com/pages/refund-policy"
              onChange={(e) => setUrl(e.target.value)}
            />
            <button className="btn-primary" onClick={analyze} disabled={loading}>
              {loading ? "Analyzing..." : "Analyze"}
            </button>
          </div>

          {error && <div className="error-text">{error}</div>}

          {data && (
            <div className="result-wrapper">
              <div className="result-card" ref={cardRef}>
                <div className="result-row">
                  <span className="result-label">Brand: </span> {data.brand}
                  &nbsp;&nbsp; <span className="result-label">Category:</span>{" "}
                  {data.category}
                </div>

                <div className="result-row" style={{ marginTop: 6 }}>
                  <span className="result-label">Return Window:</span>{" "}
                  {data.returnWindow}
                  &nbsp;&nbsp;
                  <span className="result-label">Refund:</span>{" "}
                  {data.refundType}
                </div>

                <div className="result-row" style={{ marginTop: 6 }}>
                  <span className="result-label">Method:</span>{" "}
                  {data.returnMethod}
                  &nbsp;&nbsp;
                  <span className="result-label">Costs:</span> {data.costs}
                </div>

                <div className="result-section-title">Key Conditions</div>
                <ul className="result-list">
                  {data.conditions.map((c, i) => (
                    <li key={i}>{c}</li>
                  ))}
                </ul>

                <div className="result-section-title">Risk & Benchmark</div>
                <div>
                  <span
                    className={`risk-pill ${
                      data.riskLevel === "green"
                        ? "risk-green"
                        : data.riskLevel === "yellow"
                        ? "risk-yellow"
                        : "risk-red"
                    }`}
                  >
                    {data.riskScore}
                  </span>
                  <p style={{ fontSize: "0.85rem", marginTop: 4 }}>
                    {data.benchmark}
                  </p>
                  <p style={{ fontSize: "0.8rem", color: "#9ca3af" }}>
                    Tip: {data.tip}
                  </p>
                </div>
              </div>

              <button className="btn-secondary" onClick={downloadCard}>
                Download Summary Card
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
