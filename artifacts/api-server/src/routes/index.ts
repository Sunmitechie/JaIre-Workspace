import { Router, type IRouter } from "express";
import healthRouter from "./health";
import baireRouter from "./baire";

const router: IRouter = Router();

router.use(healthRouter);
router.use(baireRouter);

export default router;
