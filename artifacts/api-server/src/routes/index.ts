import { Router, type IRouter } from "express";
import healthRouter from "./health";
import baireRouter from "./baire";
import workspacesRouter from "./workspaces";
import bookingsRouter from "./bookings";
import analyticsRouter from "./analytics";
import walletRouter from "./wallet";
import qrRouter from "./qr";
import paymentsRouter from "./payments";
import orgRouter from "./org";
import jaieRouter from "./jaie";

const router: IRouter = Router();

router.use(healthRouter);
router.use(baireRouter);
router.use("/workspaces", workspacesRouter);
router.use("/bookings", bookingsRouter);
router.use("/analytics", analyticsRouter);
router.use("/wallet", walletRouter);
router.use("/qr", qrRouter);
router.use(paymentsRouter);
router.use("/org", orgRouter);
router.use("/jaie", jaieRouter);

export default router;
