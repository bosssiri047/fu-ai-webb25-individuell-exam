import { tool } from "@langchain/core/tools";
import { z } from "zod";

const PRODUCTS_URL =
    "https://santosnr6.github.io/Data/pixelforgeproducts.json";

let catalogPromise;

const getCatalog = () => {
    if (!catalogPromise) {
        catalogPromise = fetch(PRODUCTS_URL, {
            signal: AbortSignal.timeout(5000)
        })
            .then((response) => {
                if (!response.ok) {
                    throw new Error(`Product API returned ${response.status}`);
                }
                return response.json();
            })
            .then((products) => {
                if (!Array.isArray(products)) {
                    throw new Error("Product API response was not a product list");
                }
                return products;
            })
            .catch((error) => {
                catalogPromise = undefined;
                throw error;
            });
    }

    return catalogPromise;
};

export const productCatalogTool = tool(
    async () => {
        const products = await getCatalog();
        return JSON.stringify(products);
    },
    {
        name: "get_product_catalog",
        description:
            "Fetch the complete PixelForge product catalog, including all product fields. Use it to answer product questions and find or recommend products by category, brand, name, price, ratings, stock, or other catalog details.",
        schema: z.object({})
    }
);
