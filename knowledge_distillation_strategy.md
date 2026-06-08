# Hiraia: Knowledge Distillation Strategy for Edge Deployment

## 🎯 Objective

To develop a highly capable, pedagogically specialized 3B-parameter AI tutor for offline Filipino and Cebuano education, optimized to run smoothly on entry-level 6GB RAM Android devices (e.g., Redmi 13C) via the QVAC SDK.

## ⚠️ The Problem with Off-the-Shelf Models

While open-source models like **Sailor2** (built on Qwen2.5) provide excellent Southeast Asian language fluency, their available sizes do not fit Hiraia's hardware constraints:

- **1B Model:** Lacks the reasoning depth required for multi-step science explanations and complex code-switching; prone to hallucination.
- **8B / 20B Models:** At 4-bit quantization, an 8B model requires ~4.5GB–5.0GB of RAM. On a 6GB device, this leaves insufficient memory for the Android OS, app UI, and Text-to-Speech (TTS) engine, guaranteeing Out-Of-Memory (OOM) crashes.
- **The Gap:** There is no native 3B variant in the Sailor2 lineup. The 3B parameter size is the "Goldilocks zone" for this use case.

## 💡 The Solution: 7B/14B → 3B Knowledge Distillation

Instead of costly Continual Pre-Training (CPT) from scratch, we will use **Knowledge Distillation**. We will use a powerful 7B or 14B model as a "frozen teacher" to generate high-quality, pedagogical responses, and train a 3B "student" model to mimic this behavior. 

**What we gain:**

1. **The Size Sweet Spot:** ~85% of the larger model's reasoning capability, compressed into a ~2.3GB RAM footprint (4-bit quantized).
2. **Behavioral Specialization:** The model is trained not just to *speak* Filipino/Cebuano, but to *act like a tutor* (e.g., using Socratic questioning, simple analogies, and avoiding hallucinations).
3. **Structured Output Reliability:** The model can be hardwired to output strict JSON schemas required by the Hiraia app (e.g., for triggering on-device image generation or scoring "Paid to Learn" incentives), which general models struggle to maintain.

---

## 🧩 The "Golden Dataset" Recipe

For distillation, quality vastly outweighs quantity. We target **5 to 10 billion high-quality tokens** using the following mixture:

- **60% FineWeb-2 (`fil` + `ceb`):** Provides natural fluency, grammar, and everyday conversational flow.
- **25% SEACrowd + Curated DepEd Modules:** Injects domain-specific expertise (science concepts, math reasoning, pedagogical tone).
- **15% English "Replay" Data (e.g., FineWeb-Edu):** Prevents catastrophic forgetting, ensuring the 3B model retains base logical reasoning and instruction-following capabilities.

---

## ⚙️ The Technical Pipeline (Step-by-Step)

### Phase 1: Data Aggregation & Cleaning

- **Action:** Stream datasets directly from Hugging Face to cloud storage.
- **Processing:** Apply `fasttext` for language ID filtering (>80% target language), length filtering (30–2000 words), and MinHash LSH for deduplication.
- **Storage Footprint:** ~150GB – 250GB total (raw data, cleaned JSONL, and generated responses).

### Phase 2: Two-Pass Context-Augmented Generation (The Core Safeguard)

*Crucial Note: We do not ask the 7B model to answer from memory (which risks hallucination or poor Tagalog/Cebuano phrasing). Instead, we use Static Context-Augmented Generation (a lightweight RAG approach) to force it to act as a strict summarization and formatting engine.*

- **Pass 1: Question Generation (The "Student" Simulator)**
  - Feed a chunk of verified source text (e.g., from a DepEd module) to the 7B model.
  - **Prompt:** "Read this text. Generate 3-5 natural, grade-school-level questions a Filipino student might ask about this topic in conversational Tagalog/Cebuano. Do not answer them yet."
- **Pass 2: Grounded Pedagogical Response (The "Teacher" Simulator)**
  - Feed the generated questions back to the 7B model, *along with the original source text*.
  - **Prompt:** "You are a friendly Grade 4 science tutor. Using ONLY the provided Source Fact, explain this to a 10-year-old in simple, conversational Tagalog. Use one everyday analogy. Keep it under 3 sentences. NEVER use English except for accepted scientific terms."
  - **Output:** A curated, factually grounded `(Prompt, Teacher_Response)` JSONL dataset.

### Phase 3: Automated Data Filtering (The Safety Net)

Before training, the generated dataset is passed through a Python filtering script to discard flawed entries:

- **Language Leakage:** Discard if `fasttext` detects >20% English (excluding approved scientific terms).
- **Length Constraints:** Discard if response is <10 words or >4 sentences.
- **Hallucination Markers:** Discard if output contains phrases like "As an AI," "I'm not sure," or fails a concept-tag match with the source text.

### Phase 4: Student Training

- **Framework:** **LLaMA-Factory** (industry standard, native Qwen support, robust QLoRA implementation).
- **Models:** Teacher = Qwen3.5-7B (or 14B) for superior reasoning/data generation. Student = Qwen2.5-3B for guaranteed edge compatibility.
- **Hardware:** 2x NVIDIA A100 (80GB) or H100 (80GB) GPUs.
- **Technique:** **QLoRA (4-bit Quantized Low-Rank Adaptation)**. Trains only the adapter layers, reducing VRAM usage by ~70% while retaining >95% of full fine-tuning performance.
- **Duration:** ~24 to 48 hours for 1–3 epochs.

### Phase 5: Quantization & Deployment

- **Action:** Merge the trained LoRA adapter weights back into the base 3B model.
- **Conversion:** Use `llama.cpp` to quantize the merged model to **GGUF format (Q4_K_M or Q5_K_M)**.
- **Result:** A ~2.3GB file ready for seamless integration into the QVAC SDK on target mobile devices.

---

## 💰 Budget & Resource Estimate

This pipeline reduces the cost of model specialization from the $30,000+ range (full CPT) to a highly accessible tier.


| Pipeline Phase             | Hardware / Resource             | Duration     | Estimated Cost (USD) |
| -------------------------- | ------------------------------- | ------------ | -------------------- |
| **1. Cloud Storage**       | AWS S3 or RunPod Volume (250GB) | 1–2 Months   | ~$10 – $15           |
| **2. Teacher Generation**  | 1x NVIDIA A100 (80GB)           | ~48 Hours    | ~$90 – $120          |
| **3. Student Training**    | 2x NVIDIA A100 (80GB) w/ QLoRA  | ~24–48 Hours | ~$180 – $250         |
| **4. Buffer & Testing**    | On-demand compute / API calls   | Variable     | ~$100                |
| **TOTAL ESTIMATED BUDGET** | &nbsp;                          | &nbsp;       | **~$380 – $485**     |


*(Note: This covers raw cloud compute and storage only. Assumes in-house execution of data scripting and pipeline orchestration.)*

---

## 🛡️ Risk Mitigation & Fallback

- **QVAC Compatibility:** QVAC is built on `llama.cpp`, which has first-class, native support for the Qwen architecture via GGUF. 
- **Fallback Strategy:** If a hypothetical "Qwen3.5" introduces a novel, unsupported architecture, the entire pipeline remains valid. We simply use **Qwen2.5-3B** as the student model, which is already fully supported, battle-tested, and performs exceptionally well. The distillation methodology is identical.
- **Hallucination Risk:** Mitigated by the Two-Pass Context-Augmented Generation, which forces the teacher to rely strictly on provided DepEd/source text rather than internal weights.
