import { BedrockRuntimeClient, ConverseCommand } from "@aws-sdk/client-bedrock-runtime";

const region = process.env.AWS_REGION || "ap-south-1";
const modelId = process.env.BEDROCK_MODEL_ID || "global.amazon.nova-2-lite-v1:0";

async function main() {
  console.log("CampusMate Bedrock connectivity test");
  console.log(`Region: ${region}`);
  console.log(`Model ID: ${modelId}`);
  console.log("Sending a short request. This may incur a small usage charge.\n");

  const client = new BedrockRuntimeClient({ region });
  try {
    const response = await client.send(new ConverseCommand({
      modelId,
      messages: [{ role: "user", content: [{ text: "Reply with exactly: CampusMate Nova 2 Lite connection successful!" }] }],
      inferenceConfig: { maxTokens: 80, temperature: 0.2 },
    }), { abortSignal: AbortSignal.timeout(30_000) });

    const text = (response.output?.message?.content ?? [])
      .map((block) => ("text" in block && typeof block.text === "string" ? block.text : ""))
      .filter(Boolean)
      .join("\n");

    if (!text) {
      console.error("Bedrock returned successfully but did not include text output. Inspect the model response in AWS.");
      process.exitCode = 1;
      return;
    }
    console.log("Bedrock invocation succeeded. Model response:");
    console.log(text);
  } catch (error) {
    const err = error as { name?: string; message?: string; $metadata?: { httpStatusCode?: number; requestId?: string } };
    console.error("Bedrock invocation failed.");
    console.error(`Error: ${err.name || "UnknownError"}`);
    console.error(`Message: ${err.message || "No error message returned."}`);
    if (err.$metadata?.httpStatusCode) console.error(`HTTP status: ${err.$metadata.httpStatusCode}`);
    if (err.$metadata?.requestId) console.error(`AWS request ID: ${err.$metadata.requestId}`);
    console.error("This test does not print AWS credentials. Confirm account verification, model/profile access, and bedrock:InvokeModel permission.");
    process.exitCode = 1;
  } finally {
    client.destroy();
  }
}

void main();
