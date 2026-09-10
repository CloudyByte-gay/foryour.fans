terraform {
  required_version = ">= 1.6"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.8"
    }
    google-beta = {
      source  = "hashicorp/google-beta"
      version = "~> 6.8"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
    tls = {
      source  = "hashicorp/tls"
      version = "~> 4.0"
    }
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.0"
    }
  }

  # Recommended: a remote state bucket. Create it once by hand, then
  # uncomment and `terraform init -migrate-state`.
  #
  # backend "gcs" {
  #   bucket = "YOUR_PROJECT-tfstate"
  #   prefix = "foryour-fans/gcp"
  # }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

provider "google-beta" {
  project = var.project_id
  region  = var.region
}

# Only used when var.manage_dns = true (see dns.tf). Token needs
# Zone:Read + DNS:Edit on the zone that owns var.domain.
provider "cloudflare" {
  api_token = var.cloudflare_api_token != "" ? var.cloudflare_api_token : null
}
