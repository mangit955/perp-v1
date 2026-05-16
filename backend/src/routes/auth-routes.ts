import { Router } from "express";
import { asyncHandler } from "../utils/async-handler";

export const authRouter = Router();

authRouter.post("/signup", asyncHandler(signup));
authRouter.post("/signin", asyncHandler(signin));
