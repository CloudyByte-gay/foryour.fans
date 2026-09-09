# # Optional budget alert. Only created when var.billing_account is set.
# resource "google_monitoring_notification_channel" "budget_email" {
#   for_each     = var.billing_account == "" ? toset([]) : toset(var.budget_alert_emails)
#   display_name = "foryour.fans budget alert (${each.value})"
#   type         = "email"
#   labels = {
#     email_address = each.value
#   }

#   depends_on = [google_project_service.services]
# }

# resource "google_billing_budget" "monthly" {
#   count           = var.billing_account == "" ? 0 : 1
#   billing_account = var.billing_account
#   display_name    = "${local.prefix} monthly"

#   budget_filter {
#     projects = ["projects/${var.project_id}"]
#   }

#   amount {
#     specified_amount {
#       currency_code = "USD"
#       units         = tostring(var.budget_amount_usd)
#     }
#   }

#   threshold_rules {
#     threshold_percent = 0.5
#   }
#   threshold_rules {
#     threshold_percent = 0.9
#   }
#   threshold_rules {
#     threshold_percent = 1.0
#   }

#   all_updates_rule {
#     monitoring_notification_channels = [
#       for c in google_monitoring_notification_channel.budget_email : c.id
#     ]
#     disable_default_iam_recipients = false
#   }

#   depends_on = [google_project_service.services]
# }
