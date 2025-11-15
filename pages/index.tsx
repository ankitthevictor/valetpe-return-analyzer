import { useState, useRef } from "react";
import html2canvas from "html2canvas";
import Image from "next/image";

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

  const analyze = async () => {
    setError(null);
    setData(null);

    if (!url.trim()) {
      setError("Please paste a product or policy URL.");
      return;
    }

    setLoading(true);

    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });

      let json: any;
      try {
        json = await res.json();
      } catch {
        throw new Error(
          `Server error (status ${res.status}) – could not read JSON`
        );
      }

      if (!res.ok) {
        throw new Error(json.error || `Server returned ${res.status}`);
      }

      setData(json);
    } catch (e: any) {
      console.error(e);
      setError(e.message || "Something went wrong.");
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
            <Image
              src="/valetpe-logo.png"
              alt="ValetPe"
              width={160}
              height={40}
              priority
            />
            <span className="badge">Return Policy Decoder · India</span>
          </div>

          <h1>Decode Any Return Policy in Seconds</h1>
          <p className="card-subtitle">
            Paste any product or policy link. We&apos;ll read the page and show
            a simple risk summary.
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
                  &nbsp;&nbsp;
                  <span className="result-label">Category: </span>
                  {data.category}
                </div>

                <div className="result-row">
                  <span className="result-label">Return Window:</span>{" "}
                  {data.returnWindow}
                  &nbsp;&nbsp;
                  <span className="result-label">Refund:</span>{" "}
                  {data.refundType}
                </div>

                <div className="result-row">
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
